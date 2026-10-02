import logging
from typing import Dict, Optional, Type
from config import settings
from engine.base import BaseEngine
from engine.gemini_provider import GeminiProvider
from engine.local_vlm_provider import LocalVLMProvider
from engine.vllm_provider import VLLMProvider
from engine.llamacpp_provider import LlamaCppProvider

logger = logging.getLogger("server.engine")

_REGISTRY: Dict[str, Type[BaseEngine]] = {
    "gemini_cloud": GeminiProvider,
    "local_vlm": LocalVLMProvider,
    "vllm": VLLMProvider,
    "llamacpp": LlamaCppProvider,
}

_INSTANCES: Dict[str, BaseEngine] = {}


def register_engine(mode: str, provider_cls: Type[BaseEngine]) -> None:
    """Register or override an inference engine provider class."""
    _REGISTRY[mode] = provider_cls
    logger.info("registered engine provider: %s -> %s", mode, provider_cls.__name__)


def get_engine(mode: Optional[str] = None) -> BaseEngine:
    """Retrieve or lazily instantiate singleton engine for the requested or active backend mode."""
    target_mode = mode or settings.BACKEND_MODE
    if target_mode == "auto":
        from services.hardware import detect_hardware, resolve_auto_backend
        hw = detect_hardware()
        target_mode = resolve_auto_backend(hw, settings.GEMINI_API_KEY)
        logger.info(
            "auto hardware detection resolved backend: %s (device=%s, gpu=%s, vram=%.1fGB)",
            target_mode,
            hw.device,
            hw.gpu_name or "none",
            hw.vram_total_gb,
        )

    if target_mode not in _INSTANCES:
        provider_cls = _REGISTRY.get(target_mode)
        if not provider_cls:
            logger.warning("unknown backend mode '%s', falling back to gemini_cloud", target_mode)
            provider_cls = _REGISTRY.get("gemini_cloud", GeminiProvider)
        _INSTANCES[target_mode] = provider_cls()
        logger.info("instantiated singleton engine for mode: %s (%s)", target_mode, provider_cls.__name__)
    return _INSTANCES[target_mode]


def reset_engine() -> None:
    """Reset cached engine singletons."""
    _INSTANCES.clear()


async def warmup_engine(mode: Optional[str] = None) -> None:
    """Trigger warmup lifecycle on active engine."""
    from services.hardware import detect_hardware
    hw = detect_hardware()
    logger.info(
        "hardware detected: device=%s, gpus=%d (%s), vram=%.1fGB, cpus=%d",
        hw.device,
        hw.gpu_count,
        hw.gpu_name or "none",
        hw.vram_total_gb,
        hw.cpu_count,
    )
    engine = get_engine(mode)
    logger.info("warming up engine: %s (%s)", engine.name, engine.model_name)
    await engine.warmup()



async def shutdown_engine(mode: Optional[str] = None) -> None:
    """Trigger graceful shutdown lifecycle on active engine."""
    target_mode = mode or settings.BACKEND_MODE
    if target_mode in _INSTANCES:
        engine = _INSTANCES[target_mode]
        logger.info("shutting down engine: %s", engine.name)
        await engine.shutdown()
        del _INSTANCES[target_mode]
