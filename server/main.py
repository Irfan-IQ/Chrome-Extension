"""
server/main.py — FastAPI Gateway for Redact Agent (SIH26171 / ISRO PS).

Provides an OpenAI-compatible API gateway that bridges browser agent interactions
to either cloud Gemini inference (prototype demo) or local offline open-weights VLMs.
"""

import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from schemas import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionResponseChoice,
    ChatMessage,
    FunctionCall,
    HealthResponse,
    ModelItem,
    ModelsListResponse,
    ToolCall,
    UsageInfo,
)

# Configure logging (ensuring NO raw sensitive text is logged)
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] [RedactBackend] %(message)s",
)
logger = logging.getLogger("redact_backend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("==========================================================")
    logger.info("  Starting Redact Agent Backend Gateway (ISRO SIH26171)   ")
    logger.info(f"  Mode:   {settings.BACKEND_MODE}")
    logger.info(f"  Host:   {settings.HOST}:{settings.PORT}")
    logger.info(f"  Device: {settings.DEVICE} ({settings.OS_NAME})")
    logger.info("==========================================================")
    yield
    logger.info("Shutting down Redact Agent Backend Gateway.")


app = FastAPI(
    title="Redact Agent Backend Gateway",
    description="Privacy-preserving backend gateway supporting Gemini Cloud and Local Open-Weights VLMs.",
    version="1.0.0",
    lifespan=lifespan,
)

# ------------------------------------------------------------------------------
# CORS Middleware: Enable Chrome Extensions and Localhost
# ------------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows chrome-extension://*, localhost, etc.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------------------
# Privacy-Preserving Request Logging Middleware
# ------------------------------------------------------------------------------
@app.middleware("http")
async def privacy_safe_logging(request: Request, call_next):
    start_time = time.time()
    # Log only endpoint and origin — NEVER log request body (which could hold page context)
    client_origin = request.headers.get("origin", "local")
    logger.info(f"Incoming {request.method} {request.url.path} from {client_origin}")

    response = await call_next(request)
    duration_ms = int((time.time() - start_time) * 1000)
    logger.info(f"Completed {request.method} {request.url.path} with status {response.status_code} in {duration_ms}ms")
    return response


# ------------------------------------------------------------------------------
# Core Endpoints
# ------------------------------------------------------------------------------

@app.get("/", summary="Gateway Root")
async def root():
    return {
        "service": "Redact Agent Backend Gateway",
        "status": "operational",
        "team": "Redact Rosters",
        "problem_statement": "SIH26171 (ISRO)",
        "mode": settings.BACKEND_MODE,
        "docs_url": "/docs",
    }


@app.get("/health", response_model=HealthResponse, summary="Health Check")
async def health():
    """
    Returns system status, active provider mode, and detected hardware accelerator.
    """
    return HealthResponse(
        status="ok",
        version="1.0.0",
        backend_mode=settings.BACKEND_MODE,
        device=settings.DEVICE,
        os=settings.OS_NAME,
        python=settings.PYTHON_VERSION,
    )


@app.get("/v1/models", response_model=ModelsListResponse, summary="List Models")
async def list_models():
    """
    OpenAI-compatible models discovery endpoint.
    """
    active_model = (
        settings.GEMINI_MODEL
        if settings.BACKEND_MODE == "gemini_cloud"
        else settings.LOCAL_VLM_MODEL
    )
    models = [
        ModelItem(id=active_model),
        ModelItem(id="gemini-2.0-flash"),
        ModelItem(id="Qwen/Qwen2.5-VL-7B-Instruct"),
    ]
    return ModelsListResponse(data=models)


@app.post("/v1/chat/completions", response_model=ChatCompletionResponse, summary="Chat Completions")
async def chat_completions(req: ChatCompletionRequest):
    """
    OpenAI-compatible Chat Completions endpoint.
    In Part 1: Validates incoming structure, tools, and messages.
    Part 2 connects this gateway to the Dual Engine providers (Gemini & Local VLM).
    """
    model_name = req.model or (
        settings.GEMINI_MODEL
        if settings.BACKEND_MODE == "gemini_cloud"
        else settings.LOCAL_VLM_MODEL
    )

    # Verify input messages exist
    if not req.messages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request messages cannot be empty.",
        )

    # Scaffold response for Part 1 foundation
    reply_message = ChatMessage(
        role="assistant",
        content=(
            f"[Redact Agent Gateway v1.0] Backend operational. "
            f"Active Mode: '{settings.BACKEND_MODE}'. "
            f"Device: '{settings.DEVICE}'. Ready for Part 2 engine dispatch."
        ),
    )

    return ChatCompletionResponse(
        model=model_name,
        choices=[
            ChatCompletionResponseChoice(
                index=0,
                message=reply_message,
                finish_reason="stop",
            )
        ],
        usage=UsageInfo(prompt_tokens=10, completion_tokens=25, total_tokens=35),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
