import os
import platform
from pathlib import Path
from typing import Literal, Optional

try:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parent / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
    else:
        load_dotenv()
except ImportError:
    pass


def get_device() -> str:
    val = os.getenv("DEVICE", "auto").lower().strip()
    if val != "auto":
        return val

    system = platform.system()
    if system == "Darwin" and platform.machine() in ("arm64", "aarch64"):
        return "mps"

    return "cuda" if os.name != "nt" and os.path.exists("/proc/driver/nvidia") else "cpu"


def setup_event_loop() -> str:
    """Install uvloop if available on non-Windows platforms."""
    if os.name != "nt":
        try:
            import uvloop
            uvloop.install()
            return "uvloop"
        except ImportError:
            pass
    return "asyncio"


class Settings:
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "true").lower() in ("true", "1", "yes")

    # Worker & concurrency tuning
    WORKERS: int = int(os.getenv("WORKERS", "1"))
    TIMEOUT_KEEP_ALIVE: int = int(os.getenv("TIMEOUT_KEEP_ALIVE", "30"))
    BACKLOG: int = int(os.getenv("BACKLOG", "2048"))
    LIMIT_CONCURRENCY: Optional[int] = (
        int(os.getenv("LIMIT_CONCURRENCY", "1000"))
        if os.getenv("LIMIT_CONCURRENCY")
        else None
    )
    MAX_CONCURRENT_REQUESTS: int = int(os.getenv("MAX_CONCURRENT_REQUESTS", "32"))
    REQUEST_QUEUE_TIMEOUT: float = float(os.getenv("REQUEST_QUEUE_TIMEOUT", "30.0"))

    # Prompt and prefix cache settings
    PROMPT_CACHE_ENABLED: bool = os.getenv("PROMPT_CACHE_ENABLED", "true").lower() in ("true", "1", "yes")
    PROMPT_CACHE_SIZE: int = int(os.getenv("PROMPT_CACHE_SIZE", "1024"))
    PROMPT_CACHE_TTL: float = float(os.getenv("PROMPT_CACHE_TTL", "3600.0"))

    # Dynamic micro-batching settings
    BATCHING_ENABLED: bool = os.getenv("BATCHING_ENABLED", "false").lower() in ("true", "1", "yes")
    BATCH_MAX_SIZE: int = int(os.getenv("BATCH_MAX_SIZE", "8"))
    BATCH_MAX_DELAY_MS: float = float(os.getenv("BATCH_MAX_DELAY_MS", "15.0"))




    BACKEND_MODE: Literal["gemini_cloud", "local_vlm", "vllm", "llamacpp"] = os.getenv(
        "BACKEND_MODE", "gemini_cloud"
    )

    # vLLM engine configuration (Qwen2.5-14B on A100 40GB)
    VLLM_ENDPOINT: str = os.getenv("VLLM_ENDPOINT", "http://localhost:8000/v1")
    VLLM_MODEL: str = os.getenv("VLLM_MODEL", "Qwen/Qwen2.5-14B-Instruct")
    VLLM_GPU_MEMORY_UTILIZATION: float = float(os.getenv("VLLM_GPU_MEMORY_UTILIZATION", "0.90"))
    VLLM_MAX_MODEL_LEN: int = int(os.getenv("VLLM_MAX_MODEL_LEN", "8192"))
    VLLM_API_KEY: str = os.getenv("VLLM_API_KEY", "")

    # Quantization & VRAM budget configuration (AWQ/GPTQ for Qwen2.5-14B)
    QUANTIZATION: Optional[str] = (
        os.getenv("QUANTIZATION").lower() if os.getenv("QUANTIZATION") else "awq"
    )
    KV_CACHE_DTYPE: str = os.getenv("KV_CACHE_DTYPE", "auto")
    MAX_NUM_SEQS: int = int(os.getenv("MAX_NUM_SEQS", "64"))
    MAX_NUM_BATCHED_TOKENS: int = int(os.getenv("MAX_NUM_BATCHED_TOKENS", "4096"))
    TENSOR_PARALLEL_SIZE: int = int(os.getenv("TENSOR_PARALLEL_SIZE", "1"))
    ENFORCE_EAGER: bool = os.getenv("ENFORCE_EAGER", "false").lower() in ("true", "1", "yes")

    @classmethod
    def get_vllm_command(cls) -> str:
        """Generate recommended vLLM launch command for Qwen2.5-14B on A100."""
        cmd = [
            "python", "-m", "vllm.entrypoints.openai.api_server",
            "--model", cls.VLLM_MODEL,
            "--max-model-len", str(cls.VLLM_MAX_MODEL_LEN),
            "--gpu-memory-utilization", str(cls.VLLM_GPU_MEMORY_UTILIZATION),
            "--max-num-seqs", str(cls.MAX_NUM_SEQS),
            "--max-num-batched-tokens", str(cls.MAX_NUM_BATCHED_TOKENS),
            "--tensor-parallel-size", str(cls.TENSOR_PARALLEL_SIZE),
            "--kv-cache-dtype", cls.KV_CACHE_DTYPE,
            "--trust-remote-code",
        ]
        if cls.QUANTIZATION and cls.QUANTIZATION.lower() != "none":
            cmd.extend(["--quantization", cls.QUANTIZATION])
        if cls.ENFORCE_EAGER:
            cmd.append("--enforce-eager")
        return " ".join(cmd)



    # Comma-separated list of allowed CORS origins.
    # Defaults to "*" for local dev; set explicitly in production,
    # e.g. CORS_ORIGINS="chrome-extension://abcdef123456"
    CORS_ORIGINS: list = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "*").split(",")
        if o.strip()
    ]

    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    # Keep in sync with src/modelConfig.js (GEMINI_MODEL) when migrating.
    # Verify current ids at https://aistudio.google.com/.
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")

    # Shared-secret bearer token. When set, every request must carry a
    # matching `X-Redact-Agent-Token` header (constant-time compared).
    # When blank, auth is skipped — the dev-friendly default.
    # Generate one with: python -c "import secrets; print(secrets.token_urlsafe(32))"
    AUTH_TOKEN: str = os.getenv("AUTH_TOKEN", "").strip()

    LOCAL_VLM_MODEL: str = os.getenv("LOCAL_VLM_MODEL", "Qwen/Qwen2.5-VL-7B-Instruct")
    LOCAL_VLM_ENDPOINT: str = os.getenv("LOCAL_VLM_ENDPOINT", "http://localhost:11434/v1")
    DEVICE: str = get_device()

    OS_NAME: str = platform.system()
    PYTHON_VERSION: str = platform.python_version()

    @classmethod
    def as_dict(cls) -> dict:
        return {
            "host": cls.HOST,
            "port": cls.PORT,
            "debug": cls.DEBUG,
            "backend_mode": cls.BACKEND_MODE,
            "gemini_model": cls.GEMINI_MODEL,
            "has_gemini_key": bool(cls.GEMINI_API_KEY.strip()),
            "local_vlm_model": cls.LOCAL_VLM_MODEL,
            "local_vlm_endpoint": cls.LOCAL_VLM_ENDPOINT,
            "device": cls.DEVICE,
            "os": cls.OS_NAME,
            "python": cls.PYTHON_VERSION,
        }


settings = Settings()
