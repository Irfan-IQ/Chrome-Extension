#!/usr/bin/env python3
"""
Single-process benchmark harness for local visual-PII detector candidates.

Everything runs through raw onnxruntime so the numbers are comparable and
so no AGPL library (ultralytics) enters the dependency graph.

Usage:
    python bench.py --models yunet,rtdetrv2_r18,screenpipe_pii \
                    --images images/pii --runs 20 --out out/results.json

Measured per (model, image):
    latency  - preprocess / inference / postprocess, separately
    memory   - peak RSS delta across the run
    outputs  - every detection above threshold, as normalized boxes

Nothing here scores accuracy automatically. That is deliberate: you do not
have a labelled set yet, and a harness that invents a number is worse than
one that admits it can't. Use score_manual.py to do the eyeballing.
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

import numpy as np
import onnxruntime as ort
import psutil
from PIL import Image

ROOT = Path(__file__).parent
MODELS = ROOT / "models"
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], np.float32)


# --------------------------------------------------------------------------
# result records
# --------------------------------------------------------------------------
@dataclass
class Detection:
    label: str
    score: float
    box: list  # [x1, y1, x2, y2] in ORIGINAL image pixels


@dataclass
class ImageResult:
    image: str
    width: int
    height: int
    detections: list = field(default_factory=list)
    pre_ms: list = field(default_factory=list)
    infer_ms: list = field(default_factory=list)
    post_ms: list = field(default_factory=list)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def nms(boxes, scores, iou_thresh=0.3):
    """boxes: (N,4) x1y1x2y2. Returns kept indices."""
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-9)
        order = order[1:][iou <= iou_thresh]
    return keep


def make_session(path: Path, threads: int):
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])


# --------------------------------------------------------------------------
# adapters -- one per architecture family
# --------------------------------------------------------------------------
class Adapter:
    """Subclasses implement pre(), run(), post()."""

    name = "base"
    labels: list = []

    def __init__(self, model_path: Path, threads: int, threshold: float):
        self.path = model_path
        self.threshold = threshold
        self.sess = make_session(model_path, threads)
        self.input_name = self.sess.get_inputs()[0].name
        self.size_bytes = model_path.stat().st_size

    def pre(self, img: Image.Image):
        raise NotImplementedError

    def run(self, tensor):
        return self.sess.run(None, {self.input_name: tensor})

    def post(self, outputs, orig_wh, meta):
        raise NotImplementedError


class YuNetAdapter(Adapter):
    """
    OpenCV Zoo YuNet. 12 outputs: cls_/obj_/bbox_/kps_ per stride 8,16,32.
    Input is BGR, NCHW, float32, NOT normalized. Needs manual anchor decode
    plus NMS -- the model gives you raw heads, not boxes.
    """

    name = "yunet"
    labels = ["face"]
    STRIDES = (8, 16, 32)

    def __init__(self, *a, input_size=(640, 640), **kw):
        super().__init__(*a, **kw)
        self.input_size = input_size
        self.out_names = [o.name for o in self.sess.get_outputs()]

    def pre(self, img):
        w, h = self.input_size
        resized = img.convert("RGB").resize((w, h), Image.BILINEAR)
        arr = np.asarray(resized, np.float32)[:, :, ::-1]  # RGB -> BGR
        t = arr.transpose(2, 0, 1)[None].copy()
        return t, {"scale": (img.width / w, img.height / h), "in": (w, h)}

    def post(self, outputs, orig_wh, meta):
        named = dict(zip(self.out_names, outputs))
        in_w, in_h = meta["in"]
        sx, sy = meta["scale"]
        boxes, scores = [], []
        for s in self.STRIDES:
            cls = named[f"cls_{s}"].reshape(-1)
            obj = named[f"obj_{s}"].reshape(-1)
            bbox = named[f"bbox_{s}"].reshape(-1, 4)
            cols = in_w // s
            score = np.sqrt(np.clip(cls, 0, 1) * np.clip(obj, 0, 1))
            keep = np.where(score >= self.threshold)[0]
            for i in keep:
                r, c = divmod(int(i), cols)
                cx = (c + bbox[i, 0]) * s
                cy = (r + bbox[i, 1]) * s
                bw = np.exp(bbox[i, 2]) * s
                bh = np.exp(bbox[i, 3]) * s
                boxes.append(
                    [
                        (cx - bw / 2) * sx,
                        (cy - bh / 2) * sy,
                        (cx + bw / 2) * sx,
                        (cy + bh / 2) * sy,
                    ]
                )
                scores.append(float(score[i]))
        if not boxes:
            return []
        b, s_ = np.array(boxes, np.float32), np.array(scores, np.float32)
        return [
            Detection("face", float(s_[i]), [round(float(v), 1) for v in b[i].tolist()])
            for i in nms(b, s_, 0.3)
        ]


class DetrFamilyAdapter(Adapter):
    """
    Covers RF-DETR / RT-DETR(v2) / Conditional-DETR ONNX exports.

    All three emit (boxes cxcywh-normalized, class logits) with NO NMS
    needed -- that is a real deployment advantage over YOLO in a browser,
    because you skip writing an NMS in JS.

    Differences are only in preprocessing and output ordering, so those
    are constructor flags rather than separate classes.
    """

    def __init__(
        self,
        *a,
        name,
        labels,
        input_size=(640, 640),
        normalize=True,
        boxes_first=True,
        drop_last_logit=False,
        **kw,
    ):
        super().__init__(*a, **kw)
        self.name = name
        self.labels = labels
        self.input_size = input_size
        self.normalize = normalize
        self.boxes_first = boxes_first
        self.drop_last_logit = drop_last_logit

    def pre(self, img):
        w, h = self.input_size
        arr = np.asarray(img.convert("RGB").resize((w, h), Image.BILINEAR), np.float32) / 255.0
        if self.normalize:
            arr = (arr - IMAGENET_MEAN) / IMAGENET_STD
        return arr.transpose(2, 0, 1)[None].astype(np.float32), {}

    def post(self, outputs, orig_wh, meta):
        a, b = outputs[0], outputs[1]
        boxes, logits = (a, b) if self.boxes_first else (b, a)
        boxes, logits = boxes[0], logits[0]
        if self.drop_last_logit:
            logits = logits[:, :-1]
        probs = sigmoid(logits)
        best = probs.argmax(1)
        score = probs.max(1)
        W, H = orig_wh
        dets = []
        for q in np.where(score >= self.threshold)[0]:
            cx, cy, bw, bh = boxes[q]
            cls = int(best[q])
            dets.append(
                Detection(
                    self.labels[cls] if cls < len(self.labels) else f"class_{cls}",
                    float(score[q]),
                    [
                        round(float(cx - bw / 2) * W, 1),
                        round(float(cy - bh / 2) * H, 1),
                        round(float(cx + bw / 2) * W, 1),
                        round(float(cy + bh / 2) * H, 1),
                    ],
                )
            )
        return dets


# --------------------------------------------------------------------------
# registry
# --------------------------------------------------------------------------
SCREENPIPE_LABELS = [
    "private_person", "private_email", "private_phone", "private_address",
    "private_url", "private_company", "private_repo", "private_handle",
    "private_channel", "private_id", "private_date", "secret",
]

COCO = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
    "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
    "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
    "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
    "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup",
    "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
    "hair drier", "toothbrush",
]


def build(key: str, threads: int, threshold: float) -> Adapter:
    if key == "yunet":
        return YuNetAdapter(
            MODELS / "yunet" / "face_detection_yunet_2023mar.onnx",
            threads, threshold,
        )
    if key == "screenpipe_pii":
        # 300 queries x 13 channels; last channel is no-object -> drop it.
        return DetrFamilyAdapter(
            MODELS / "screenpipe_pii" / "rfdetr_v11.onnx",
            threads, threshold,
            name="screenpipe_pii", labels=SCREENPIPE_LABELS,
            input_size=(512, 512), normalize=True,
            boxes_first=True, drop_last_logit=True,
        )
    if key == "rtdetrv2_r18":
        # RT-DETR does NOT imagenet-normalize: rescale to [0,1] only.
        return DetrFamilyAdapter(
            MODELS / "rtdetrv2_r18" / "onnx" / "model.onnx",
            threads, threshold,
            name="rtdetrv2_r18", labels=COCO,
            input_size=(640, 640), normalize=False,
            boxes_first=False,
        )
    if key == "conditional_detr_signature":
        return DetrFamilyAdapter(
            MODELS / "conditional_detr_signature" / "onnx" / "model.onnx",
            threads, threshold,
            name="conditional_detr_signature", labels=["signature"],
            input_size=(640, 640), normalize=True,
            boxes_first=False,
        )
    raise SystemExit(f"unknown model key: {key}")


# --------------------------------------------------------------------------
# runner
# --------------------------------------------------------------------------
def bench_model(key, image_paths, runs, warmup, threads, threshold):
    proc = psutil.Process()
    rss_before = proc.memory_info().rss

    t0 = time.perf_counter()
    ad = build(key, threads, threshold)
    load_ms = (time.perf_counter() - t0) * 1000
    rss_after_load = proc.memory_info().rss

    results, peak_rss = [], rss_after_load
    for p in image_paths:
        img = Image.open(p)
        r = ImageResult(image=p.name, width=img.width, height=img.height)

        for _ in range(warmup):
            t, m = ad.pre(img)
            ad.post(ad.run(t), (img.width, img.height), m)

        for i in range(runs):
            a = time.perf_counter(); t, m = ad.pre(img)
            b = time.perf_counter(); outs = ad.run(t)
            c = time.perf_counter(); dets = ad.post(outs, (img.width, img.height), m)
            d = time.perf_counter()
            r.pre_ms.append((b - a) * 1000)
            r.infer_ms.append((c - b) * 1000)
            r.post_ms.append((d - c) * 1000)
            if i == 0:
                r.detections = [asdict(x) for x in dets]
            peak_rss = max(peak_rss, proc.memory_info().rss)
        results.append(r)

    def agg(field_):
        vals = [v for r in results for v in getattr(r, field_)]
        vals.sort()
        if not vals:
            return {}
        return {
            "p50": round(statistics.median(vals), 2),
            "p90": round(vals[int(len(vals) * 0.9) - 1], 2),
            "max": round(vals[-1], 2),
        }

    return {
        "model": key,
        "onnx_path": str(ad.path),
        "model_size_mb": round(ad.size_bytes / 1e6, 2),
        "load_ms": round(load_ms, 1),
        "rss_load_mb": round((rss_after_load - rss_before) / 1e6, 1),
        "rss_peak_mb": round((peak_rss - rss_before) / 1e6, 1),
        "threshold": threshold,
        "threads": threads,
        "latency_ms": {
            "preprocess": agg("pre_ms"),
            "inference": agg("infer_ms"),
            "postprocess": agg("post_ms"),
        },
        "per_image": [asdict(r) | {"pre_ms": [], "infer_ms": [], "post_ms": []} for r in results],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True, help="comma-separated keys")
    ap.add_argument("--images", default="images/pii")
    ap.add_argument("--runs", type=int, default=20)
    ap.add_argument("--warmup", type=int, default=3)
    ap.add_argument("--threads", type=int, default=4,
                    help="Set to 4 to approximate a browser WASM thread pool.")
    ap.add_argument("--threshold", type=float, default=0.30)
    ap.add_argument("--out", default="out/results.json")
    args = ap.parse_args()

    img_dir = ROOT / args.images
    imgs = sorted(
        p for p in img_dir.iterdir()
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    )
    if not imgs:
        raise SystemExit(f"no images in {img_dir}")
    print(f"{len(imgs)} images, {args.runs} runs each, {args.threads} threads\n")

    all_results = []
    for key in args.models.split(","):
        key = key.strip()
        print(f"--- {key} ---")
        try:
            res = bench_model(key, imgs, args.runs, args.warmup, args.threads, args.threshold)
        except Exception as e:  # noqa: BLE001
            print(f"  FAILED: {type(e).__name__}: {e}\n")
            all_results.append({"model": key, "error": f"{type(e).__name__}: {e}"})
            continue
        lat = res["latency_ms"]
        print(f"  size {res['model_size_mb']} MB | load {res['load_ms']} ms | "
              f"peak RSS +{res['rss_peak_mb']} MB")
        print(f"  infer p50 {lat['inference'].get('p50')} ms / "
              f"p90 {lat['inference'].get('p90')} ms | "
              f"pre p50 {lat['preprocess'].get('p50')} ms | "
              f"post p50 {lat['postprocess'].get('p50')} ms")
        n = sum(len(i["detections"]) for i in res["per_image"])
        print(f"  {n} detections above {args.threshold} across {len(imgs)} images\n")
        all_results.append(res)

    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(all_results, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
