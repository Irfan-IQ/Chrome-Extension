import hashlib
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Tuple


@dataclass
class CacheStats:
    hits: int = 0
    misses: int = 0
    evictions: int = 0
    size: int = 0

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return round(self.hits / total, 4) if total > 0 else 0.0


class PromptPrefixCache:
    """Thread-safe LRU & TTL cache for prompt prefixes and tool declarations."""

    def __init__(self, max_size: int = 1024, default_ttl: float = 3600.0):
        self.max_size = max(1, max_size)
        self.default_ttl = default_ttl
        self._cache: OrderedDict[str, Tuple[float, Any]] = OrderedDict()
        self.stats = CacheStats()

    def _hash_key(self, key_data: Any) -> str:
        if isinstance(key_data, str):
            raw = key_data.encode("utf-8")
        elif isinstance(key_data, bytes):
            raw = key_data
        else:
            raw = str(key_data).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def get(self, key: str) -> Optional[Any]:
        if key not in self._cache:
            self.stats.misses += 1
            return None

        exp, val = self._cache[key]
        if time.time() > exp:
            del self._cache[key]
            self.stats.misses += 1
            self.stats.size = len(self._cache)
            return None

        # Move to end for LRU ordering
        self._cache.move_to_end(key)
        self.stats.hits += 1
        return val

    def set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        ttl = ttl if ttl is not None else self.default_ttl
        exp = time.time() + ttl

        if key in self._cache:
            self._cache.move_to_end(key)
        self._cache[key] = (exp, value)

        while len(self._cache) > self.max_size:
            self._cache.popitem(last=False)
            self.stats.evictions += 1

        self.stats.size = len(self._cache)

    def get_or_compute(self, key: str, compute_fn: Callable[[], Any], ttl: Optional[float] = None) -> Any:
        cached = self.get(key)
        if cached is not None:
            return cached
        computed = compute_fn()
        self.set(key, computed, ttl=ttl)
        return computed

    def compute_prefix_key(self, system_prompt: Optional[str], tools: Optional[Any]) -> str:
        h = hashlib.sha256()
        if system_prompt:
            h.update(system_prompt.encode("utf-8"))
        else:
            h.update(b"__no_system__")
        if tools:
            h.update(str(tools).encode("utf-8"))
        else:
            h.update(b"__no_tools__")
        return h.hexdigest()

    def clear(self) -> None:
        self._cache.clear()
        self.stats.size = 0

    def get_telemetry(self) -> Dict[str, Any]:
        return {
            "size": len(self._cache),
            "max_size": self.max_size,
            "hits": self.stats.hits,
            "misses": self.stats.misses,
            "evictions": self.stats.evictions,
            "hit_rate": self.stats.hit_rate,
        }


_cache_service: Optional[PromptPrefixCache] = None


def get_cache_service(max_size: int = 1024, ttl: float = 3600.0) -> PromptPrefixCache:
    global _cache_service
    if _cache_service is None:
        _cache_service = PromptPrefixCache(max_size=max_size, default_ttl=ttl)
    return _cache_service
