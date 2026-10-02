import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional

logger = logging.getLogger("server.concurrency")


class ConcurrencyLimitExceeded(Exception):
    """Raised when request queue timeout expires while waiting for an execution slot."""
    pass


class ConcurrencyLimiter:
    """Async backpressure semaphore limiter for controlling peak LLM/VLM concurrency."""

    def __init__(self, max_concurrent: int = 32, queue_timeout: float = 30.0):
        self.max_concurrent = max(1, max_concurrent)
        self.queue_timeout = max(0.1, queue_timeout)
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._active_requests: int = 0
        self._queued_requests: int = 0

    def _get_semaphore(self) -> asyncio.Semaphore:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.max_concurrent)
        return self._semaphore

    @property
    def active_requests(self) -> int:
        return self._active_requests

    @property
    def queued_requests(self) -> int:
        return self._queued_requests

    @asynccontextmanager
    async def acquire(self):
        sem = self._get_semaphore()
        self._queued_requests += 1
        acquired = False
        try:
            try:
                await asyncio.wait_for(sem.acquire(), timeout=self.queue_timeout)
                acquired = True
            except asyncio.TimeoutError:
                logger.warning(
                    "concurrency limit reached (%d/%d active, %d waiting), queue timeout expired",
                    self._active_requests,
                    self.max_concurrent,
                    self._queued_requests,
                )
                raise ConcurrencyLimitExceeded(
                    f"Server busy: active={self._active_requests}/{self.max_concurrent}, "
                    f"queued={self._queued_requests}. Queue timeout ({self.queue_timeout}s) exceeded."
                )
            self._active_requests += 1
            self._queued_requests -= 1
            try:
                yield
            finally:
                self._active_requests -= 1
        finally:
            if acquired:
                sem.release()
            else:
                self._queued_requests -= 1
