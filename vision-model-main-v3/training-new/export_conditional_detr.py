#!/usr/bin/env python3
"""
Export tech4humans/conditional-detr-50-signature-detector to ONNX.

Why this exists: that repo ships PyTorch safetensors only, and it is the
ONLY permissively-licensed (Apache-2.0) signature detector I could find.
The popular one (tech4humans/yolov8s-signature-detector) ships ONNX but
is AGPL-3.0 and gated, which is a non-starter for a distributed extension.

Install first:
    pip install "optimum[onnxruntime]>=1.23" "transformers>=4.45" \
        torch --index-url https://download.pytorch.org/whl/cpu

Then:
    python export_conditional_detr.py

Known caveat, read before you spend an afternoon on this:
Transformers.js does NOT support the `conditional_detr` architecture.
I verified this against the shipped registry (both v3.8.1 and v4.3.0):
the object-detection map contains only detr, rt_detr, rt_detr_v2,
rf_detr, d_fine, table-transformer, yolos.

So an ONNX export of this model can run in the browser via raw
onnxruntime-web, but NOT via the transformers.js `pipeline()` API.
Its postprocessing is trivial (sigmoid + cxcywh, no NMS), so raw ORT
is maybe 40 lines of JS. That is the tradeoff.
"""
import shutil
import subprocess
import sys
from pathlib import Path

REPO = "tech4humans/conditional-detr-50-signature-detector"
OUT = Path(__file__).parent / "models" / "conditional_detr_signature" / "onnx"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, "-m", "optimum.exporters.onnx",
        "--model", REPO,
        "--task", "object-detection",
        # Fix the input shape. DETR's default processor resizes the shortest
        # edge to 800 (max 1333), which on a 1920x1080 screenshot is both slow
        # and makes WebGPU unhappy -- WebGPU strongly prefers static shapes.
        "--batch_size", "1",
        "--num_channels", "3",
        "--height", "640",
        "--width", "640",
        str(OUT),
    ]
    print(" ".join(cmd))
    subprocess.check_call(cmd)

    print("\nExported. Files:")
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name}  {f.stat().st_size / 1e6:.1f} MB")

    print(
        "\nNext: quantize to int8 for the browser.\n"
        "  optimum-cli onnxruntime quantize --onnx_model "
        f"{OUT} --avx512_vnni -o {OUT.parent / 'onnx_q8'}\n"
        "Then re-run bench.py against both and compare mAP-by-eye and latency.\n"
        "Expect the fp32 file around 170 MB and q8 around 45 MB."
    )
    if shutil.which("optimum-cli") is None:
        print("(optimum-cli not on PATH -- install optimum[onnxruntime])")


if __name__ == "__main__":
    main()
