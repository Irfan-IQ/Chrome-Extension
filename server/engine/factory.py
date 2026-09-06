from config import settings
from engine.gemini_provider import GeminiProvider
from engine.local_vlm_provider import LocalVLMProvider


def get_engine():
    if settings.BACKEND_MODE == "local_vlm":
        return LocalVLMProvider()
    return GeminiProvider()
