# Visual-PII detector bench

A CPU ONNX Runtime harness for comparing candidate detectors before any of
them goes near the extension. No training, no dataset creation, no changes
to `vision-model`.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python download_models.py --dry-run     # see what it will fetch
python download_models.py               # ~250 MB
```

`tech4humans/yolov8s-signature-detector` is gated and AGPL-3.0. It is
excluded by default. If you want it purely as a quality reference:

```bash
hf auth login
python download_models.py --include-agpl
```

The Apache-licensed signature model ships PyTorch only, so export it:

```bash
pip install "optimum[onnxruntime]>=1.23" "transformers>=4.45" \
    torch --index-url https://download.pytorch.org/whl/cpu
python export_conditional_detr.py
```

## Test images

Drop 15–25 PNG screenshots into `images/pii/` and 10–15 into
`images/clean/`. Use real screenshots at real resolutions (1280×800,
1512×982, 1920×1080), not cropped stock photos — the whole question is
how these behave on a browser viewport.

`images/pii/` should cover, roughly evenly:

- a webmail thread with a profile photo (face, small, ~40 px)
- a video call grid (several faces, varied sizes)
- a social profile page (one large face)
- a checkout page with a saved card widget
- a photo of a physical payment card uploaded into a form
- a passport / driving-licence scan in a KYC upload flow
- a PDF viewer showing a signed contract (signature)
- a signature-pad widget mid-signing
- a GitHub settings page with a token visible (secret)
- a terminal with an env var dump
- a CRM record with a name, address and phone

`images/clean/` is the control set: dashboards, docs, code editors, a
maps view, a news site. No PII. **This set matters more than the PII set.**
A redaction extension that black-boxes a colleague's avatar on a Jira
board once a day is a product that gets uninstalled.

Everything stays local — do not commit real screenshots.

## Run

```bash
python bench.py --models yunet,rtdetrv2_r18,screenpipe_pii \
                --images images/pii --runs 20 --threshold 0.30 \
                --out out/pii.json

python bench.py --models yunet,rtdetrv2_r18,screenpipe_pii \
                --images images/clean --runs 5 --threshold 0.30 \
                --out out/clean.json

python visualize.py --results out/pii.json --images images/pii --out out/viz
```

`--threads 4` is the default and approximates a browser WASM thread pool.
Also run `--threads 1` — some users' machines effectively give you that.

## Metrics to record

Per model, filled in by hand into one table:

**Cost**
- ONNX file size, fp32 / fp16 / q8 (this is download cost per user)
- session load time, cold and warm
- peak RSS delta (browser tab budget is far tighter than a Python process)
- inference p50 / p90 / max, separately from preprocess and postprocess —
  preprocessing is often the surprise, and in JS it's worse than in numpy

**Detection quality** (manual, from `out/viz/`)
- per category (face / card / ID / signature / secret): hit, miss, or
  partial box, per image
- tightest score at which the true positive still fires → gives you a
  defensible per-class threshold instead of the current magic 0.75/0.80/0.90
- false positives on `images/clean/` — count them, and note *what* they
  were. One FP class repeating is fixable; scattered FPs are not.

**Deployability**
- does the architecture appear in the Transformers.js object-detection
  registry (`detr`, `rt_detr`, `rt_detr_v2`, `rf_detr`, `d_fine`,
  `table-transformer`, `yolos`)? If not, you're writing raw
  onnxruntime-web glue.
- does postprocessing need NMS in JS? (DETR family: no. YOLO family: yes.)
- static input shape? WebGPU strongly prefers it.
- licence, and whether it survives being shipped in a distributed extension

## What this harness deliberately does not do

It does not compute mAP. You have no labelled set, so any number it
printed would be fiction. Look at the images.

## OpenCV candidate geometry
The browser OpenCV proposal detector accepts rectangle aspect ratios from 1.2 through 2.2. This is intentionally class-agnostic and is meant to improve coverage of portrait/vertical document-like regions.
