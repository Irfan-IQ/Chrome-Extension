import * as ort from "onnxruntime-web";

const MODEL_PATH = "/models/yunet/face_detection_yunet_2023mar.onnx";
const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32];
const SCORE_THRESHOLD = 0.30;
const NMS_THRESHOLD = 0.30;

type Box = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  confidence: number;
};

type Detection = {
  label: "face";
  confidence: number;
  bbox: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  };
};

let session: ort.InferenceSession | null = null;
let sessionLoadPromise: Promise<ort.InferenceSession> | null = null;

async function getSession(): Promise<{ session: ort.InferenceSession; loadMs: number }> {
  if (session) {
    return { session, loadMs: 0 };
  }

  if (sessionLoadPromise) {
    const start = performance.now();
    const loaded = await sessionLoadPromise;
    return { session: loaded, loadMs: performance.now() - start };
  }

  const start = performance.now();

  sessionLoadPromise = ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ["wasm"],
  });

  session = await sessionLoadPromise;

  const loadMs = performance.now() - start;
  console.log(`YuNet worker loaded in ${loadMs.toFixed(2)} ms`);

  return { session, loadMs };
}

function createInputTensor(
  image: ImageBitmap,
): {
  tensor: ort.Tensor;
  scale: number;
  offsetX: number;
  offsetY: number;
} {
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("Could not create YuNet OffscreenCanvas context");
  }

  const scale = Math.min(
    INPUT_SIZE / image.width,
    INPUT_SIZE / image.height,
  );

  const resizedWidth = Math.round(image.width * scale);
  const resizedHeight = Math.round(image.height * scale);
  const offsetX = Math.floor((INPUT_SIZE - resizedWidth) / 2);
  const offsetY = Math.floor((INPUT_SIZE - resizedHeight) / 2);

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(image, offsetX, offsetY, resizedWidth, resizedHeight);

  const rgba = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const pixelCount = INPUT_SIZE * INPUT_SIZE;
  const inputData = new Float32Array(3 * pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const rgbaIndex = i * 4;
    inputData[i] = rgba[rgbaIndex + 2];
    inputData[pixelCount + i] = rgba[rgbaIndex + 1];
    inputData[2 * pixelCount + i] = rgba[rgbaIndex];
  }

  return {
    tensor: new ort.Tensor("float32", inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    scale,
    offsetX,
    offsetY,
  };
}

function calculateIoU(a: Box, b: Box): number {
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

function applyNMS(boxes: Box[]): Detection[] {
  boxes.sort((a, b) => b.confidence - a.confidence);
  const kept: Box[] = [];

  for (const box of boxes) {
    let suppressed = false;

    for (const existing of kept) {
      if (calculateIoU(box, existing) >= NMS_THRESHOLD) {
        suppressed = true;
        break;
      }
    }

    if (!suppressed) {
      kept.push(box);
    }
  }

  return kept.map((box) => ({
    label: "face",
    confidence: box.confidence,
    bbox: {
      xmin: box.xmin,
      ymin: box.ymin,
      xmax: box.xmax,
      ymax: box.ymax,
    },
  }));
}

function decodeOutputs(
  outputs: Record<string, ort.Tensor>,
  scale: number,
  offsetX: number,
  offsetY: number,
  originalWidth: number,
  originalHeight: number,
): Detection[] {
  const boxes: Box[] = [];

  for (const stride of STRIDES) {
    const clsTensor = outputs[`cls_${stride}`];
    const objTensor = outputs[`obj_${stride}`];
    const bboxTensor = outputs[`bbox_${stride}`];

    if (!clsTensor || !objTensor || !bboxTensor) {
      throw new Error(`Missing YuNet outputs for stride ${stride}`);
    }

    const cls = clsTensor.data as Float32Array;
    const obj = objTensor.data as Float32Array;
    const bbox = bboxTensor.data as Float32Array;
    const featureWidth = INPUT_SIZE / stride;
    const numberOfCells = featureWidth * featureWidth;

    for (let index = 0; index < numberOfCells; index++) {
      const confidence = cls[index] * obj[index];

      if (confidence < SCORE_THRESHOLD) {
        continue;
      }

      const gridX = index % featureWidth;
      const gridY = Math.floor(index / featureWidth);
      const bboxIndex = index * 4;

      const centerX = bbox[bboxIndex] * stride + gridX * stride;
      const centerY = bbox[bboxIndex + 1] * stride + gridY * stride;
      const width = Math.exp(bbox[bboxIndex + 2]) * stride;
      const height = Math.exp(bbox[bboxIndex + 3]) * stride;

      let xmin = (centerX - width / 2 - offsetX) / scale;
      let ymin = (centerY - height / 2 - offsetY) / scale;
      let xmax = (centerX + width / 2 - offsetX) / scale;
      let ymax = (centerY + height / 2 - offsetY) / scale;

      xmin = Math.max(0, Math.min(originalWidth, xmin));
      ymin = Math.max(0, Math.min(originalHeight, ymin));
      xmax = Math.max(0, Math.min(originalWidth, xmax));
      ymax = Math.max(0, Math.min(originalHeight, ymax));

      if (xmax <= xmin || ymax <= ymin) {
        continue;
      }

      boxes.push({ xmin, ymin, xmax, ymax, confidence });
    }
  }

  return applyNMS(boxes);
}

self.addEventListener("message", async (event: MessageEvent) => {
  const message = event.data as { id: number; image: ImageBitmap };

  try {
    const { session: detector, loadMs } = await getSession();
    const preprocessStart = performance.now();
    const { tensor, scale, offsetX, offsetY } = createInputTensor(message.image);
    const preprocessMs = performance.now() - preprocessStart;

    const inferenceStart = performance.now();
    const outputs = await detector.run({ input: tensor });
    const inferenceMs = performance.now() - inferenceStart;

    const postprocessStart = performance.now();
    const detections = decodeOutputs(
      outputs,
      scale,
      offsetX,
      offsetY,
      message.image.width,
      message.image.height,
    );
    const postprocessMs = performance.now() - postprocessStart;

    message.image.close();

    self.postMessage({
      id: message.id,
      detections,
      loadMs,
      preprocessMs,
      inferenceMs,
      postprocessMs,
      workerMs: preprocessMs + inferenceMs + postprocessMs,
    });
  } catch (error) {
    message.image.close();
    self.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
