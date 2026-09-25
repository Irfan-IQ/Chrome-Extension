import { loadOpenCV } from "@opencvjs/worker";

type Detection = {
  label: "card_like_quad";
  confidence: number;
  bbox: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  };
  polygon: number[][];
};

type Box = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

const MAX_SIDE = 1280;
const CANNY_LO = 40;
const CANNY_HI = 120;
const MIN_AREA_FRAC = 0.01;
const MAX_AREA_FRAC = 0.60;
const AR_MIN = 1.2;
const AR_MAX = 1.9;
const TOP_K = 15;
const NMS_THRESHOLD = 0.5;

let cvPromise: ReturnType<typeof loadOpenCV> | null = null;

async function getOpenCV() {
  if (!cvPromise) {
    cvPromise = loadOpenCV();
  }

  return cvPromise;
}

function iou(a: Box, b: Box): number {
  const xMin = Math.max(a.xmin, b.xmin);
  const yMin = Math.max(a.ymin, b.ymin);
  const xMax = Math.min(a.xmax, b.xmax);
  const yMax = Math.min(a.ymax, b.ymax);
  const width = Math.max(0, xMax - xMin);
  const height = Math.max(0, yMax - yMin);
  const intersection = width * height;
  const areaA = (a.xmax - a.xmin) * (a.ymax - a.ymin);
  const areaB = (b.xmax - b.xmin) * (b.ymax - b.ymin);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

function nms(
  candidates: Array<{ score: number; bbox: Box; polygon: number[][] }>,
): Detection[] {
  candidates.sort((a, b) => b.score - a.score);
  const kept: typeof candidates = [];

  for (const candidate of candidates) {
    if (kept.some((existing) => iou(candidate.bbox, existing.bbox) >= NMS_THRESHOLD)) {
      continue;
    }
    kept.push(candidate);
  }

  return kept.slice(0, TOP_K).map((candidate) => ({
    label: "card_like_quad",
    confidence: candidate.score,
    bbox: candidate.bbox,
    polygon: candidate.polygon,
  }));
}

async function detect(image: ImageBitmap) {
  const cv = await getOpenCV();

  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("Could not create OpenCV OffscreenCanvas context");
  }

  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, image.width, image.height);
  const source = cv.matFromImageData(imageData);

  let small = source;
  let gray: any;
  let edges: any;
  let kernel3: any;
  let kernel5: any;
  let contours: any;
  let hierarchy: any;

  try {
    const height = source.rows;
    const width = source.cols;
    const scale = Math.min(1, MAX_SIDE / Math.max(height, width));

    if (scale < 1) {
      small = new cv.Mat();
      cv.resize(
        source,
        small,
        new cv.Size(Math.round(width * scale), Math.round(height * scale)),
        0,
        0,
        cv.INTER_AREA,
      );
    }

    const smallHeight = small.rows;
    const smallWidth = small.cols;

    gray = new cv.Mat();
    edges = new cv.Mat();
    kernel3 = cv.Mat.ones(3, 3, cv.CV_8U);
    kernel5 = cv.Mat.ones(5, 5, cv.CV_8U);

    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(gray, edges, CANNY_LO, CANNY_HI);
    cv.dilate(edges, edges, kernel3);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel5);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const candidates: Array<{ score: number; bbox: Box; polygon: number[][] }> = [];

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);

      try {
        const area = cv.contourArea(contour);
        const fraction = area / (smallWidth * smallHeight);

        if (fraction < MIN_AREA_FRAC || fraction > MAX_AREA_FRAC) {
          continue;
        }

        const perimeter = cv.arcLength(contour, true);
        const approx = new cv.Mat();

        try {
          cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

          if (approx.rows !== 4 || !cv.isContourConvex(approx)) {
            continue;
          }

          const rotated = cv.minAreaRect(contour);
          const rw = rotated.size.width;
          const rh = rotated.size.height;

          if (Math.min(rw, rh) < 1) {
            continue;
          }

          const aspectRatio = Math.max(rw, rh) / Math.min(rw, rh);

          if (aspectRatio < AR_MIN || aspectRatio > AR_MAX) {
            continue;
          }

          const score = Math.min(1, area / (rw * rh));
          const points: number[][] = [];

          for (let row = 0; row < approx.rows; row++) {
            const x = approx.intPtr(row, 0)[0] / scale;
            const y = approx.intPtr(row, 0)[1] / scale;
            points.push([x, y]);
          }

          const xs = points.map((point) => point[0]);
          const ys = points.map((point) => point[1]);

          candidates.push({
            score,
            bbox: {
              xmin: Math.max(0, Math.min(width, Math.min(...xs))),
              ymin: Math.max(0, Math.min(height, Math.min(...ys))),
              xmax: Math.max(0, Math.min(width, Math.max(...xs))),
              ymax: Math.max(0, Math.min(height, Math.max(...ys))),
            },
            polygon: points,
          });
        } finally {
          approx.delete();
        }
      } finally {
        contour.delete();
      }
    }

    return nms(candidates);
  } finally {
    source.delete();
    if (small !== source) {
      small.delete();
    }
    gray?.delete();
    edges?.delete();
    kernel3?.delete();
    kernel5?.delete();
    contours?.delete();
    hierarchy?.delete();
  }
}

self.addEventListener("message", async (event: MessageEvent) => {
  const message = event.data as { id: number; image: ImageBitmap };
  const start = performance.now();

  try {
    const detections = await detect(message.image);
    const workerMs = performance.now() - start;
    message.image.close();

    self.postMessage({
      id: message.id,
      detections,
      workerMs,
    });
  } catch (error) {
    message.image.close();
    self.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
