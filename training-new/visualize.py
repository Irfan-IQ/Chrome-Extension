#!/usr/bin/env python3
"""
Render bench.py's detections onto the source images so you can actually
look at them. Accuracy judgement on 20 images is a human job; this just
removes the excuse not to do it.

    python visualize.py --results out/results.json --images images/pii --out out/viz
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).parent
COLORS = ["#ff2d55", "#0a84ff", "#30d158", "#ff9f0a", "#bf5af2", "#64d2ff"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="out/results.json")
    ap.add_argument("--images", default="images/pii")
    ap.add_argument("--out", default="out/viz")
    args = ap.parse_args()

    results = json.loads((ROOT / args.results).read_text())
    img_dir, out_dir = ROOT / args.images, ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    for mi, res in enumerate(results):
        if "error" in res:
            continue
        color = COLORS[mi % len(COLORS)]
        for entry in res["per_image"]:
            src = img_dir / entry["image"]
            if not src.exists():
                continue
            img = Image.open(src).convert("RGB")
            d = ImageDraw.Draw(img)
            for det in entry["detections"]:
                x1, y1, x2, y2 = det["box"]
                d.rectangle([x1, y1, x2, y2], outline=color, width=3)
                d.text((x1 + 4, max(0, y1 - 14)),
                       f"{det['label']} {det['score']:.2f}", fill=color)
            dest = out_dir / f"{res['model']}__{entry['image']}"
            img.save(dest)
            print(f"  {dest.name}  ({len(entry['detections'])} boxes)")


if __name__ == "__main__":
    main()
