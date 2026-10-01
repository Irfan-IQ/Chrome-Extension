import hmac
import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from engine import get_engine
from schemas import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionResponseChoice,
    ChatMessage,
    HealthResponse,
    ModelItem,
    ModelsListResponse,
    UsageInfo,
)

logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("server")

# Endpoints that are allowed through without an auth token even when one
# is configured. Health + root + models are read-only metadata, used by
# browsers to decide whether the server is reachable before prompting the
# user for the token.
UNAUTHENTICATED_PATHS = frozenset({"/", "/health", "/v1/models"})


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
    yield
    logger.info("server stopped")


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
    allow_headers=["Content-Type", "X-Redact-Agent-Token"],
)


@app.middleware("http")
async def auth_and_log(request: Request, call_next):
    t0 = time.time()

    # Shared-secret check. Skipped when AUTH_TOKEN is unset (dev default)
    # or when the request targets a public metadata endpoint.
    if settings.AUTH_TOKEN and request.url.path not in UNAUTHENTICATED_PATHS:
        presented = request.headers.get("x-redact-agent-token", "")
        if not hmac.compare_digest(presented, settings.AUTH_TOKEN):
            logger.warning(
                "rejecting %s %s — missing or wrong X-Redact-Agent-Token",
                request.method, request.url.path,
            )
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "missing or invalid X-Redact-Agent-Token"},
            )

    response = await call_next(request)
    ms = int((time.time() - t0) * 1000)
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
    return HealthResponse(
        status="ok",
        version="1.0.0",
        backend_mode=settings.BACKEND_MODE,
        device=settings.DEVICE,
        os=settings.OS_NAME,
        python=settings.PYTHON_VERSION,
    )


@app.get("/v1/models", response_model=ModelsListResponse)
async def list_models():
    active_model = (
        settings.GEMINI_MODEL
        if settings.BACKEND_MODE == "gemini_cloud"
        else settings.LOCAL_VLM_MODEL
    )
    # De-duplicate so the active model isn't listed twice when it already
    # matches one of the defaults.
    ids = []
    for mid in [active_model, settings.GEMINI_MODEL, settings.LOCAL_VLM_MODEL]:
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
    return await engine.generate(req)



if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
