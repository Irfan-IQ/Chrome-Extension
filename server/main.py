import hmac
import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
try:
    from fastapi.responses import ORJSONResponse
    FastJSONResponse = ORJSONResponse
except ImportError:
    from fastapi.responses import JSONResponse
    FastJSONResponse = JSONResponse

import logging.handlers
import queue
from config import settings
from engine import get_engine, warmup_engine, shutdown_engine
from services import (
    close_http_client,
    json_dumps,
    ConcurrencyLimiter,
    ConcurrencyLimitExceeded,
    get_cache_service,
    get_queue_coordinator,
    get_privacy_stats,
    get_metrics_tracker,
)
from schemas import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionResponseChoice,
    ChatMessage,
    HealthResponse,
    ServerMetricsResponse,
    ModelItem,
    ModelsListResponse,
    UsageInfo,
)

limiter = ConcurrencyLimiter(
    max_concurrent=settings.MAX_CONCURRENT_REQUESTS,
    queue_timeout=settings.REQUEST_QUEUE_TIMEOUT,
)

queue_coordinator = get_queue_coordinator(
    max_batch_size=settings.BATCH_MAX_SIZE,
    max_delay_ms=settings.BATCH_MAX_DELAY_MS,
    enabled=settings.BATCHING_ENABLED,
)

# Non-blocking async queue logging setup
_log_queue = queue.SimpleQueue()
_queue_handler = logging.handlers.QueueHandler(_log_queue)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
_queue_listener = logging.handlers.QueueListener(_log_queue, _stream_handler)
_queue_listener.start()

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO if not settings.DEBUG else logging.DEBUG)
root_logger.addHandler(_queue_handler)

logger = logging.getLogger("server")


# Endpoints that are allowed through without an auth token even when one
# is configured. Health + root + models + metrics are read-only metadata, used by
# browsers to decide whether the server is reachable before prompting the
# user for the token.
UNAUTHENTICATED_PATHS = frozenset({"/", "/health", "/v1/models", "/metrics"})



@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"server up on {settings.HOST}:{settings.PORT} ({settings.BACKEND_MODE})")
    if not settings.DEBUG and settings.CORS_ORIGINS == ["*"]:
        logger.warning(
            "CORS_ORIGINS='*' with DEBUG=false — this is almost certainly a "
            "misconfiguration. Set CORS_ORIGINS=chrome-extension://<your-id> "
            "in server/.env for production use."
        )
    if not settings.AUTH_TOKEN:
        logger.warning(
            "AUTH_TOKEN is empty — the /v1/chat/completions endpoint is open "
            "to any process that can reach this host. For anything other "
            "than solo-local dev, set AUTH_TOKEN in server/.env (generate "
            "with: python -c 'import secrets; print(secrets.token_urlsafe(32))')."
        )
    if settings.BATCHING_ENABLED:
        queue_coordinator.start()
    await warmup_engine()
    yield
    await shutdown_engine()
    if settings.BATCHING_ENABLED:
        await queue_coordinator.stop()
    await close_http_client()
    logger.info("server stopped")
    _queue_listener.stop()


app = FastAPI(title="Redact Agent Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    # Credentials (cookies) are never used by the extension, so this stays False.
    # Combining allow_origins=["*"] with allow_credentials=True is invalid per
    # the CORS spec and causes strict browsers to block the response.
    allow_credentials=False,
    allow_methods=["*"],
    # Explicitly list the headers the extension sends so a tightened CORS
    # policy doesn't silently drop them (particularly the auth header).
    allow_headers=["Content-Type", "X-Redact-Agent-Token", "Authorization"],
)


@app.middleware("http")
async def auth_and_log(request: Request, call_next):
    t0 = time.time()

    # Shared-secret check. Skipped when AUTH_TOKEN is unset (dev default)
    # or when the request targets a public metadata endpoint.
    if settings.AUTH_TOKEN and request.url.path not in UNAUTHENTICATED_PATHS:
        auth_header = request.headers.get("authorization", "")
        bearer_token = (
            auth_header[7:].strip()
            if auth_header.lower().startswith("bearer ")
            else auth_header.strip()
        )
        presented = request.headers.get("x-redact-agent-token", "") or bearer_token
        if not hmac.compare_digest(presented, settings.AUTH_TOKEN):
            logger.warning(
                "rejecting %s %s — missing or wrong authentication token",
                request.method, request.url.path,
            )
            return FastJSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "missing or invalid authorization token"},
            )

    response = await call_next(request)
    ms = int((time.time() - t0) * 1000)
    get_metrics_tracker().record_request(float(ms), is_error=(response.status_code >= 400))
    logger.info(f"{request.method} {request.url.path} {response.status_code} ({ms}ms)")
    return response


@app.get("/")
async def root():
    return {
        "status": "ok",
        "mode": settings.BACKEND_MODE,
    }


@app.get("/health", response_model=HealthResponse)
async def health():
    cache_stats = get_cache_service().stats
    hw = settings.get_hardware_profile()
    priv_stats = get_privacy_stats()
    engine = get_engine()
    return HealthResponse(
        status="ok",
        version="1.0.0",
        backend_mode=settings.BACKEND_MODE,
        active_model=engine.model_name,
        device=settings.DEVICE,
        os=settings.OS_NAME,
        python=settings.PYTHON_VERSION,
        active_requests=limiter.active_requests,
        queued_requests=limiter.queued_requests,
        cache_hits=cache_stats.hits,
        cache_misses=cache_stats.misses,
        cache_hit_rate=cache_stats.hit_rate,
        gpu_name=hw.gpu_name,
        vram_total_gb=hw.vram_total_gb,
        cpu_count=hw.cpu_count,
        privacy_scans=priv_stats["total_scans"],
        privacy_fast_path_rate=priv_stats["fast_path_rate"],
    )


@app.get("/metrics", response_model=ServerMetricsResponse)
async def get_metrics():
    tracker = get_metrics_tracker()
    cache_stats = get_cache_service().stats
    hw = settings.get_hardware_profile()
    priv_stats = get_privacy_stats()
    engine = get_engine()

    return ServerMetricsResponse(
        uptime_seconds=tracker.uptime_seconds,
        total_requests=tracker.total_requests,
        total_errors=tracker.total_errors,
        avg_latency_ms=tracker.avg_latency_ms,
        p95_latency_ms=tracker.p95_latency_ms,
        requests_per_second=tracker.requests_per_second,
        active_requests=limiter.active_requests,
        queued_requests=limiter.queued_requests,
        backend_mode=settings.BACKEND_MODE,
        active_model=engine.model_name,
        device=settings.DEVICE,
        gpu_name=hw.gpu_name,
        vram_total_gb=hw.vram_total_gb,
        cpu_count=hw.cpu_count,
        cache_hits=cache_stats.hits,
        cache_misses=cache_stats.misses,
        cache_hit_rate=cache_stats.hit_rate,
        privacy_scans=priv_stats["total_scans"],
        privacy_fast_path_rate=priv_stats["fast_path_rate"],
    )


@app.get("/v1/models", response_model=ModelsListResponse)
async def list_models():
    engine = get_engine()
    active_model = engine.model_name
    ids = []
    for mid in [active_model, settings.VLLM_MODEL, settings.LLAMACPP_MODEL, settings.GEMINI_MODEL, settings.LOCAL_VLM_MODEL]:
        if mid and mid not in ids:
            ids.append(mid)
    return ModelsListResponse(data=[ModelItem(id=mid) for mid in ids])


@app.post("/v1/chat/completions", response_model=ChatCompletionResponse)
async def chat_completions(req: ChatCompletionRequest):
    if not req.messages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="messages cannot be empty",
        )

    engine = get_engine()

    if req.stream:
        async def event_generator():
            try:
                async with limiter.acquire():
                    async for chunk in engine.generate_stream(req):
                        payload = json_dumps(chunk.model_dump(exclude_none=True))
                        yield f"data: {payload}\n\n"
                    yield "data: [DONE]\n\n"
            except ConcurrencyLimitExceeded as exc:
                err_payload = json_dumps({"error": {"message": str(exc), "type": "rate_limit_error"}})
                yield f"data: {err_payload}\n\ndata: [DONE]\n\n"
            except Exception as exc:
                logger.error(f"streaming error: {exc}", exc_info=True)
                err_payload = json_dumps({"error": {"message": str(exc), "type": "server_error"}})
                yield f"data: {err_payload}\n\ndata: [DONE]\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    try:
        async with limiter.acquire():
            if settings.BATCHING_ENABLED and queue_coordinator.enabled:
                return await queue_coordinator.submit(req, fallback_fn=engine.generate)
            return await engine.generate(req)
    except ConcurrencyLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": "2"},
        ) from exc



if __name__ == "__main__":
    import uvicorn
    from config import setup_event_loop

    loop_type = setup_event_loop()
    logger.info(f"event loop backend: {loop_type}")

    run_kwargs = {
        "host": settings.HOST,
        "port": settings.PORT,
        "loop": "auto",
        "http": "httptools",
        "ws": "none",
        "timeout_keep_alive": settings.TIMEOUT_KEEP_ALIVE,
        "backlog": settings.BACKLOG,
    }
    if settings.LIMIT_CONCURRENCY:
        run_kwargs["limit_concurrency"] = settings.LIMIT_CONCURRENCY

    if settings.DEBUG:
        run_kwargs["reload"] = True
    else:
        run_kwargs["workers"] = settings.WORKERS

    uvicorn.run("main:app", **run_kwargs)
