import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"server up on {settings.HOST}:{settings.PORT} ({settings.BACKEND_MODE})")
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
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    t0 = time.time()
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
    return ModelsListResponse(
        data=[
            ModelItem(id=active_model),
            ModelItem(id="gemini-2.0-flash"),
            ModelItem(id="Qwen/Qwen2.5-VL-7B-Instruct"),
        ]
    )


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
