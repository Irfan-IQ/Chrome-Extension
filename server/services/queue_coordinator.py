import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Coroutine, Dict, List, Optional

logger = logging.getLogger("server.batching")


@dataclass
class BatchRequestItem:
    payload: Any
    future: asyncio.Future
    enqueued_at: float


@dataclass
class BatchCoordinatorStats:
    total_requests: int = 0
    total_batches: int = 0
    total_direct_requests: int = 0
    max_batch_seen: int = 0

    @property
    def avg_batch_size(self) -> float:
        if self.total_batches == 0:
            return 0.0
        return round((self.total_requests - self.total_direct_requests) / self.total_batches, 2)


class QueueCoordinator:
    """Async dynamic micro-batch coordinator for local LLM/VLM inference."""

    def __init__(
        self,
        batch_processor: Optional[Callable[[List[Any]], Coroutine[Any, Any, List[Any]]]] = None,
        max_batch_size: int = 8,
        max_delay_ms: float = 15.0,
        enabled: bool = False,
    ):
        self.batch_processor = batch_processor
        self.max_batch_size = max(1, max_batch_size)
        self.max_delay_sec = max(0.001, max_delay_ms / 1000.0)
        self.enabled = enabled
        self._queue: asyncio.Queue[BatchRequestItem] = asyncio.Queue()
        self._worker_task: Optional[asyncio.Task] = None
        self._running = False
        self.stats = BatchCoordinatorStats()

    def start(self):
        if self.enabled and not self._running:
            self._running = True
            self._worker_task = asyncio.create_task(
                self._batch_loop(), name="batch_coordinator_worker"
            )
            logger.info(
                "started micro-batch coordinator (max_size=%d, max_delay=%.1fms)",
                self.max_batch_size,
                self.max_delay_sec * 1000,
            )

    async def stop(self):
        self._running = False
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None

        while not self._queue.empty():
            try:
                item = self._queue.get_nowait()
                if not item.future.done():
                    item.future.set_exception(RuntimeError("Batch coordinator stopped"))
            except asyncio.QueueEmpty:
                break

    async def submit(
        self,
        payload: Any,
        fallback_fn: Optional[Callable[[Any], Coroutine[Any, Any, Any]]] = None,
    ) -> Any:
        self.stats.total_requests += 1

        if not self.enabled or not self.batch_processor:
            self.stats.total_direct_requests += 1
            if fallback_fn:
                return await fallback_fn(payload)
            raise RuntimeError("Batching is disabled and no fallback processor was provided")

        if not self._running:
            self.start()

        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        item = BatchRequestItem(payload=payload, future=future, enqueued_at=time.time())
        await self._queue.put(item)
        return await future

    async def _batch_loop(self):
        while self._running:
            try:
                first_item = await self._queue.get()
                items: List[BatchRequestItem] = [first_item]
                start_time = time.time()

                while len(items) < self.max_batch_size:
                    time_left = self.max_delay_sec - (time.time() - start_time)
                    if time_left <= 0:
                        break
                    try:
                        next_item = await asyncio.wait_for(
                            self._queue.get(), timeout=time_left
                        )
                        items.append(next_item)
                    except asyncio.TimeoutError:
                        break

                await self._dispatch_batch(items)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(
                    "unexpected error in batch coordinator loop: %s", exc, exc_info=True
                )
                await asyncio.sleep(0.01)

    async def _dispatch_batch(self, items: List[BatchRequestItem]):
        count = len(items)
        self.stats.total_batches += 1
        if count > self.stats.max_batch_seen:
            self.stats.max_batch_seen = count

        payloads = [item.payload for item in items]
        try:
            assert self.batch_processor is not None
            results = await self.batch_processor(payloads)
            if not isinstance(results, list) or len(results) != count:
                raise ValueError(
                    f"Batch processor expected {count} results, got "
                    f"{len(results) if isinstance(results, list) else type(results)}"
                )

            for item, res in zip(items, results):
                if not item.future.done():
                    if isinstance(res, Exception):
                        item.future.set_exception(res)
                    else:
                        item.future.set_result(res)

        except Exception as exc:
            for item in items:
                if not item.future.done():
                    item.future.set_exception(exc)

    def get_telemetry(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "running": self._running,
            "queue_depth": self._queue.qsize(),
            "total_requests": self.stats.total_requests,
            "total_batches": self.stats.total_batches,
            "avg_batch_size": self.stats.avg_batch_size,
            "max_batch_seen": self.stats.max_batch_seen,
        }


_queue_coordinator: Optional[QueueCoordinator] = None


def get_queue_coordinator(
    batch_processor: Optional[Callable[[List[Any]], Coroutine[Any, Any, List[Any]]]] = None,
    max_batch_size: int = 8,
    max_delay_ms: float = 15.0,
    enabled: bool = False,
) -> QueueCoordinator:
    global _queue_coordinator
    if _queue_coordinator is None:
        _queue_coordinator = QueueCoordinator(
            batch_processor=batch_processor,
            max_batch_size=max_batch_size,
            max_delay_ms=max_delay_ms,
            enabled=enabled,
        )
    return _queue_coordinator
