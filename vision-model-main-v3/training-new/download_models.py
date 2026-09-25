#!/usr/bin/env python3
"""
Download the candidate models into ./models/.

Every repo/filename below was verified to exist at time of writing, but
verify again yourself -- HF repos get renamed, gated, and deleted.
Run with --dry-run first to see what it will fetch.
"""
import argparse
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

MODELS_DIR = Path(__file__).parent / "models"

# (key, repo_id, filename | None for full snapshot, notes)
SINGLE_FILES = [
    (
        "yunet",
        "opencv/face_detection_yunet",
        "face_detection_yunet_2023mar.onnx",
        "MIT. ~340KB. Fixed 640x640 input. Faces only.",
    ),
    (
        "yunet_dynamic",
        "pollen-robotics/face_detection_yunet_2026may",
        "face_detection_yunet_2026may.onnx",
        "MIT. Dynamic H/W (multiples of 32). Preferred if it loads.",
    ),
    (
        "screenpipe_pii",
        "screenpipe/pii-image-redactor",
        "rfdetr_v11.onnx",
        "CC-BY-NC-4.0 -- EVALUATION ONLY, NOT SHIPPABLE. RF-DETR, 512x512.",
    ),
]

SNAPSHOTS = [
    (
        "rtdetrv2_r18",
        "onnx-community/rtdetr_v2_r18vd-ONNX",
        "Apache-2.0. COCO-80. Native transformers.js + WebGPU. Baseline.",
    ),
    (
        "conditional_detr_signature",
        "tech4humans/conditional-detr-50-signature-detector",
        "Apache-2.0. PyTorch only -- needs ONNX export, see export script.",
    ),
]

# Gated + AGPL-3.0. Only pulled with --include-agpl, and only so you can
# measure what the permissive alternative is giving up.
AGPL_OPTIONAL = [
    (
        "yolov8s_signature",
        "tech4humans/yolov8s-signature-detector",
        "yolov8s.onnx",
        "AGPL-3.0 + gated. Benchmark reference only. Do not ship.",
    ),
]


def fetch_file(key, repo, fname, notes, dry):
    dest = MODELS_DIR / key
    print(f"[{key}] {repo}/{fname}\n         {notes}")
    if dry:
        return
    dest.mkdir(parents=True, exist_ok=True)
    try:
        p = hf_hub_download(repo_id=repo, filename=fname, local_dir=dest)
        print(f"         -> {p} ({Path(p).stat().st_size / 1e6:.1f} MB)")
    except Exception as e:  # noqa: BLE001
        print(f"         !! FAILED: {type(e).__name__}: {e}", file=sys.stderr)


def fetch_snapshot(key, repo, notes, dry):
    dest = MODELS_DIR / key
    print(f"[{key}] {repo} (snapshot)\n         {notes}")
    if dry:
        return
    try:
        p = snapshot_download(repo_id=repo, local_dir=dest)
        total = sum(f.stat().st_size for f in Path(p).rglob("*") if f.is_file())
        print(f"         -> {p} ({total / 1e6:.1f} MB total)")
    except Exception as e:  # noqa: BLE001
        print(f"         !! FAILED: {type(e).__name__}: {e}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--include-agpl",
        action="store_true",
        help="Also fetch AGPL-licensed weights (benchmark reference only).",
    )
    args = ap.parse_args()

    MODELS_DIR.mkdir(exist_ok=True)

    for key, repo, fname, notes in SINGLE_FILES:
        fetch_file(key, repo, fname, notes, args.dry_run)
    for key, repo, notes in SNAPSHOTS:
        fetch_snapshot(key, repo, notes, args.dry_run)

    if args.include_agpl:
        print("\n--- AGPL-3.0 weights (gated: `hf auth login` first) ---")
        for key, repo, fname, notes in AGPL_OPTIONAL:
            fetch_file(key, repo, fname, notes, args.dry_run)
    else:
        print("\n(skipping AGPL weights; pass --include-agpl to fetch them)")


if __name__ == "__main__":
    main()
