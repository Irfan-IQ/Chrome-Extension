import os
import platform
import shutil
import subprocess
from dataclasses import dataclass
from typing import Optional


@dataclass
class HardwareProfile:
    device: str
    gpu_count: int = 0
    gpu_name: Optional[str] = None
    vram_total_gb: float = 0.0
    vram_free_gb: float = 0.0
    cpu_count: int = 1
    system_name: str = platform.system()


def detect_hardware() -> HardwareProfile:
    """Inspect system hardware (NVIDIA GPU / Apple Silicon / CPU cores) safely."""
    cpu_count = os.cpu_count() or 1
    system = platform.system()

    try:
        import torch
        if torch.cuda.is_available():
            gpu_count = torch.cuda.device_count()
            name = torch.cuda.get_device_name(0) if gpu_count > 0 else "NVIDIA GPU"
            props = torch.cuda.get_device_properties(0)
            total_gb = round(props.total_memory / (1024 ** 3), 2)
            try:
                free_b, _ = torch.cuda.mem_get_info()
                free_gb = round(free_b / (1024 ** 3), 2)
            except Exception:
                free_gb = total_gb
            return HardwareProfile(
                device="cuda",
                gpu_count=gpu_count,
                gpu_name=name,
                vram_total_gb=total_gb,
                vram_free_gb=free_gb,
                cpu_count=cpu_count,
            )
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return HardwareProfile(
                device="mps",
                gpu_count=1,
                gpu_name="Apple Silicon MPS",
                vram_total_gb=16.0,
                vram_free_gb=16.0,
                cpu_count=cpu_count,
            )
    except ImportError:
        pass

    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi:
        try:
            cmd = [
                nvidia_smi,
                "--query-gpu=name,memory.total,memory.free",
                "--format=csv,noheader,nounits",
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=2.0)
            if res.returncode == 0 and res.stdout.strip():
                lines = res.stdout.strip().split("\n")
                first = lines[0].split(",")
                if len(first) >= 3:
                    gpu_name = first[0].strip()
                    total_mb = float(first[1].strip())
                    free_mb = float(first[2].strip())
                    return HardwareProfile(
                        device="cuda",
                        gpu_count=len(lines),
                        gpu_name=gpu_name,
                        vram_total_gb=round(total_mb / 1024.0, 2),
                        vram_free_gb=round(free_mb / 1024.0, 2),
                        cpu_count=cpu_count,
                    )
        except Exception:
            pass

    if system == "Darwin" and platform.machine() in ("arm64", "aarch64"):
        return HardwareProfile(
            device="mps",
            gpu_count=1,
            gpu_name="Apple Neural Engine / MPS",
            vram_total_gb=16.0,
            vram_free_gb=16.0,
            cpu_count=cpu_count,
        )

    return HardwareProfile(
        device="cpu",
        gpu_count=0,
        gpu_name=None,
        vram_total_gb=0.0,
        vram_free_gb=0.0,
        cpu_count=cpu_count,
    )


def resolve_auto_backend(
    hw: HardwareProfile,
    gemini_key: Optional[str] = None,
) -> str:
    """Recommend the optimal backend mode based on detected hardware profile."""
    if hw.device == "cuda" and hw.vram_total_gb >= 20.0:
        return "vllm"

    if hw.device == "cuda" and hw.vram_total_gb >= 8.0:
        return "vllm"

    if hw.device == "cpu" or hw.vram_total_gb < 8.0:
        if gemini_key and gemini_key.strip():
            return "gemini_cloud"
        return "llamacpp"

    return "gemini_cloud" if (gemini_key and gemini_key.strip()) else "local_vlm"
