import os
import platform
from pathlib import Path
from typing import Literal

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


class Settings:
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "true").lower() in ("true", "1", "yes")

    BACKEND_MODE: Literal["gemini_cloud", "local_vlm"] = os.getenv(
        "BACKEND_MODE", "gemini_cloud"
    )

    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

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
