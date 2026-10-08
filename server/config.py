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

    from services.hardware import detect_hardware
    return detect_hardware().device


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

    # Default backend. `vllm` points at the self-hosted Qwen3-VL instance;
    # `gemini_cloud` is kept as an opt-in fallback. `auto` picks based on
    # hardware/keys (see services/hardware.resolve_auto_backend).
    BACKEND_MODE: Literal["auto", "gemini_cloud", "local_vlm", "vllm", "llamacpp"] = os.getenv(
        "BACKEND_MODE", "vllm"
    )

    @classmethod
    def get_hardware_profile(cls):
        from services.hardware import detect_hardware
        return detect_hardware()


    # ------------------------------------------------------------------
    # vLLM engine — Qwen3-VL-30B-A3B-Instruct on NVIDIA H200 (141 GB HBM3e)
    # ------------------------------------------------------------------
    # MoE: 30B total params, ~3B active per token. BF16 fits comfortably on
    # a single H200 with room for a long context + KV cache + vision tower.
    # No quantization — the H200 has plenty of VRAM and VL quant kernels are
    # still rough in vLLM.
    VLLM_ENDPOINT: str = os.getenv("VLLM_ENDPOINT", "http://localhost:8001/v1")
    VLLM_MODEL: str = os.getenv("VLLM_MODEL", "Qwen/Qwen3-VL-30B-A3B-Instruct")
    VLLM_GPU_MEMORY_UTILIZATION: float = float(os.getenv("VLLM_GPU_MEMORY_UTILIZATION", "0.90"))
    VLLM_MAX_MODEL_LEN: int = int(os.getenv("VLLM_MAX_MODEL_LEN", "32768"))
    VLLM_API_KEY: str = os.getenv("VLLM_API_KEY", "")
    VLLM_DTYPE: str = os.getenv("VLLM_DTYPE", "bfloat16")

    # Qwen3-VL-specific tuning. `limit-mm-per-prompt` caps how many images
    # vLLM accepts in one request (the extension sends a single redacted
    # screenshot per turn, so 2 gives a safe margin). Tool-call parser is
    # `hermes` — the parser Qwen3 ships with for OpenAI-shape function
    # calling in vLLM.
    VLLM_LIMIT_MM_PER_PROMPT: str = os.getenv("VLLM_LIMIT_MM_PER_PROMPT", "image=2")
    VLLM_TOOL_CALL_PARSER: str = os.getenv("VLLM_TOOL_CALL_PARSER", "hermes")
    VLLM_ENABLE_AUTO_TOOL_CHOICE: bool = os.getenv(
        "VLLM_ENABLE_AUTO_TOOL_CHOICE", "true"
    ).lower() in ("true", "1", "yes")

    # Quantization setting. Unquantized BF16 is optimal on H200 (141GB VRAM).
    # Optional AWQ/GPTQ/FP8 supported for smaller hardware slices.
    QUANTIZATION: Optional[str] = (
        os.getenv("QUANTIZATION").lower() if os.getenv("QUANTIZATION") else None
    )

    KV_CACHE_DTYPE: str = os.getenv("KV_CACHE_DTYPE", "auto")
    MAX_NUM_SEQS: int = int(os.getenv("MAX_NUM_SEQS", "64"))
    MAX_NUM_BATCHED_TOKENS: int = int(os.getenv("MAX_NUM_BATCHED_TOKENS", "8192"))
    TENSOR_PARALLEL_SIZE: int = int(os.getenv("TENSOR_PARALLEL_SIZE", "1"))
    ENFORCE_EAGER: bool = os.getenv("ENFORCE_EAGER", "false").lower() in ("true", "1", "yes")

    @classmethod
    def get_vllm_command(cls, quantization: Optional[str] = None) -> str:
        """Recommended vLLM launch command for Qwen3-VL-30B-A3B on an H200.

        Prints a copy-pasteable command. Note the two VL-specific pieces:
        `--limit-mm-per-prompt` enables multimodal input, and the tool-call
        parser flags light up OpenAI function-calling for the agent flow.
        """
        if quantization is not None:
            q = quantization
        elif "settings" in globals():
            q = getattr(settings, "QUANTIZATION", cls.QUANTIZATION)
        else:
            q = cls.QUANTIZATION

        cmd = [
            "python", "-m", "vllm.entrypoints.openai.api_server",
            "--model", cls.VLLM_MODEL,
            "--dtype", cls.VLLM_DTYPE,
            "--max-model-len", str(cls.VLLM_MAX_MODEL_LEN),
            "--gpu-memory-utilization", str(cls.VLLM_GPU_MEMORY_UTILIZATION),
            "--max-num-seqs", str(cls.MAX_NUM_SEQS),
            "--max-num-batched-tokens", str(cls.MAX_NUM_BATCHED_TOKENS),
            "--tensor-parallel-size", str(cls.TENSOR_PARALLEL_SIZE),
            "--kv-cache-dtype", cls.KV_CACHE_DTYPE,
            "--limit-mm-per-prompt", cls.VLLM_LIMIT_MM_PER_PROMPT,
            "--trust-remote-code",
        ]
        if q and q.lower() != "none":
            cmd.extend(["--quantization", q])
        if cls.VLLM_ENABLE_AUTO_TOOL_CHOICE:
            cmd.extend([
                "--enable-auto-tool-choice",
                "--tool-call-parser", cls.VLLM_TOOL_CALL_PARSER,
            ])
        if cls.ENFORCE_EAGER:
            cmd.append("--enforce-eager")
        return " ".join(cmd)

    # Minimal-resource fallback engine (llama.cpp GGUF). Kept for the
    # no-GPU case — not used in the default Qwen3-VL deployment.
    LLAMACPP_ENDPOINT: str = os.getenv("LLAMACPP_ENDPOINT", "http://localhost:8080/v1")
    LLAMACPP_MODEL: str = os.getenv("LLAMACPP_MODEL", "qwen3-vl-30b-a3b-instruct-q4_k_m.gguf")
    LLAMACPP_THREADS: int = int(os.getenv("LLAMACPP_THREADS", "6"))
    LLAMACPP_N_GPU_LAYERS: int = int(os.getenv("LLAMACPP_N_GPU_LAYERS", "0"))

    @classmethod
    def get_llamacpp_command(cls) -> str:
        """Recommended llama-server CLI command for minimal hardware."""
        return (
            f"llama-server -m {cls.LLAMACPP_MODEL} --port 8080 -t {cls.LLAMACPP_THREADS} "
            f"-ngl {cls.LLAMACPP_N_GPU_LAYERS} -c 8192 --cont-batching"
        )




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

    # Secondary local VLM path (Ollama / generic OpenAI-compatible proxy).
    # Only used when BACKEND_MODE=local_vlm. The default vLLM path above is
    # the primary self-hosted route.
    LOCAL_VLM_MODEL: str = os.getenv("LOCAL_VLM_MODEL", "Qwen/Qwen3-VL-30B-A3B-Instruct")
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
            "vllm_model": cls.VLLM_MODEL,
            "vllm_endpoint": cls.VLLM_ENDPOINT,
            "local_vlm_model": cls.LOCAL_VLM_MODEL,
            "local_vlm_endpoint": cls.LOCAL_VLM_ENDPOINT,
            "device": cls.DEVICE,
            "os": cls.OS_NAME,
            "python": cls.PYTHON_VERSION,
        }


settings = Settings()
