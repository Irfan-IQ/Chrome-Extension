import math
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass
class ServerMetricsTracker:
    """Thread-safe rolling window metrics tracker for server latency, RPS, and throughput."""

    start_time: float = field(default_factory=time.time)
    total_requests: int = 0
    total_errors: int = 0
    _latencies: deque = field(default_factory=lambda: deque(maxlen=1000))
    _recent_request_timestamps: deque = field(default_factory=lambda: deque(maxlen=500))

    def record_request(self, latency_ms: float, is_error: bool = False) -> None:
        self.total_requests += 1
        if is_error:
            self.total_errors += 1
        self._latencies.append(latency_ms)
        self._recent_request_timestamps.append(time.time())

    @property
    def uptime_seconds(self) -> float:
        return round(time.time() - self.start_time, 2)

    @property
    def avg_latency_ms(self) -> float:
        if not self._latencies:
            return 0.0
        return round(sum(self._latencies) / len(self._latencies), 2)

    @property
    def p95_latency_ms(self) -> float:
        if not self._latencies:
            return 0.0
        sorted_lats = sorted(self._latencies)
        idx = max(0, min(len(sorted_lats) - 1, math.ceil(0.95 * len(sorted_lats)) - 1))
        return round(sorted_lats[idx], 2)

    @property
    def requests_per_second(self) -> float:
        now = time.time()
        cutoff = now - 10.0
        while self._recent_request_timestamps and self._recent_request_timestamps[0] < cutoff:
            self._recent_request_timestamps.popleft()
        count = len(self._recent_request_timestamps)
        return round(count / 10.0, 2) if count > 0 else 0.0

    def get_summary(self) -> Dict[str, Any]:
        return {
            "uptime_seconds": self.uptime_seconds,
            "total_requests": self.total_requests,
            "total_errors": self.total_errors,
            "avg_latency_ms": self.avg_latency_ms,
            "p95_latency_ms": self.p95_latency_ms,
            "requests_per_second": self.requests_per_second,
        }

    def reset(self) -> None:
        self.start_time = time.time()
        self.total_requests = 0
        self.total_errors = 0
        self._latencies.clear()
        self._recent_request_timestamps.clear()


metrics_tracker = ServerMetricsTracker()


def get_metrics_tracker() -> ServerMetricsTracker:
    return metrics_tracker
