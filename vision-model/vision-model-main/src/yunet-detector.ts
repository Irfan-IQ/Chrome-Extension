import * as ort from "onnxruntime-web";

let session: ort.InferenceSession | null = null;

const MODEL_PATH =
  "/models/yunet/face_detection_yunet_2023mar.onnx";

const INPUT_SIZE = 640;

const STRIDES = [8, 16, 32];

const SCORE_THRESHOLD = 0.30;

const NMS_THRESHOLD = 0.30;

export type YuNetDetection = {
  label: string;

  confidence: number;

  bbox: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  };
};

// ----------------------------------------
// Load / cache YuNet
// ----------------------------------------

export async function getYuNetSession(): Promise<ort.InferenceSession> {
  if (session) {
    return session;
  }

  console.log("Loading YuNet...");

  const start = performance.now();

  session = await ort.InferenceSession.create(
    MODEL_PATH,
    {
      executionProviders: ["wasm"],
    }
  );

  console.log(
    `YuNet loaded in ${(performance.now() - start).toFixed(2)} ms`
  );

  console.log(
    "Input names:",
    session.inputNames
  );

  console.log(
    "Output names:",
    session.outputNames
  );

  return session;
}

// ----------------------------------------
// Create 640x640 BGR tensor
// ----------------------------------------

function createInputTensor(
  image: HTMLImageElement
): {
  tensor: ort.Tensor;
  scale: number;
  offsetX: number;
  offsetY: number;
} {
  const canvas =
    document.createElement("canvas");

  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;

  const ctx =
    canvas.getContext("2d");

  if (!ctx) {
    throw new Error(
      "Could not create YuNet canvas context"
    );
  }

  const scale = Math.min(
    INPUT_SIZE / image.naturalWidth,
    INPUT_SIZE / image.naturalHeight
  );

  const resizedWidth =
    Math.round(
      image.naturalWidth * scale
    );

  const resizedHeight =
    Math.round(
      image.naturalHeight * scale
    );

  const offsetX =
    Math.floor(
      (INPUT_SIZE - resizedWidth) / 2
    );

  const offsetY =
    Math.floor(
      (INPUT_SIZE - resizedHeight) / 2
    );

  ctx.fillStyle = "black";

  ctx.fillRect(
    0,
    0,
    INPUT_SIZE,
    INPUT_SIZE
  );

  ctx.drawImage(
    image,
    offsetX,
    offsetY,
    resizedWidth,
    resizedHeight
  );

  const imageData =
    ctx.getImageData(
      0,
      0,
      INPUT_SIZE,
      INPUT_SIZE
    );

  const rgba =
    imageData.data;

  const pixelCount =
    INPUT_SIZE * INPUT_SIZE;

  const inputData =
    new Float32Array(
      3 * pixelCount
    );

  const blueOffset = 0;

  const greenOffset =
    pixelCount;

  const redOffset =
    pixelCount * 2;

  for (
    let i = 0;
    i < pixelCount;
    i++
  ) {
    const rgbaIndex =
      i * 4;

    inputData[
      blueOffset + i
    ] =
      rgba[rgbaIndex + 2];

    inputData[
      greenOffset + i
    ] =
      rgba[rgbaIndex + 1];

    inputData[
      redOffset + i
    ] =
      rgba[rgbaIndex];
  }

  const tensor =
    new ort.Tensor(
      "float32",
      inputData,
      [
        1,
        3,
        INPUT_SIZE,
        INPUT_SIZE,
      ]
    );

  return {
    tensor,
    scale,
    offsetX,
    offsetY,
  };
}

// ----------------------------------------
// Decode YuNet outputs
// ----------------------------------------

function decodeOutputs(
  outputs: Record<
    string,
    ort.Tensor
  >,
  scale: number,
  offsetX: number,
  offsetY: number,
  originalWidth: number,
  originalHeight: number
): YuNetDetection[] {
  const boxes: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    confidence: number;
  }[] = [];

  for (
    let level = 0;
    level < STRIDES.length;
    level++
  ) {
    const stride =
      STRIDES[level];

    const clsTensor =
      outputs[`cls_${stride}`];

    const objTensor =
      outputs[`obj_${stride}`];

    const bboxTensor =
      outputs[`bbox_${stride}`];

    if (
      !clsTensor ||
      !objTensor ||
      !bboxTensor
    ) {
      throw new Error(
        `Missing YuNet outputs for stride ${stride}`
      );
    }

    const cls =
      clsTensor.data as Float32Array;

    const obj =
      objTensor.data as Float32Array;

    const bbox =
      bboxTensor.data as Float32Array;

    const featureWidth =
      INPUT_SIZE / stride;

    const featureHeight =
      INPUT_SIZE / stride;

    const numberOfCells =
      featureWidth *
      featureHeight;

    for (
      let index = 0;
      index < numberOfCells;
      index++
    ) {
      const classScore =
        cls[index];

      const objectness =
        obj[index];

      const confidence =
        classScore *
        objectness;

      if (
        confidence <
        SCORE_THRESHOLD
      ) {
        continue;
      }

      const gridX =
        index % featureWidth;

      const gridY =
        Math.floor(
          index / featureWidth
        );

      const bboxIndex =
        index * 4;

      const dx =
        bbox[bboxIndex];

      const dy =
        bbox[bboxIndex + 1];

      const dw =
        bbox[bboxIndex + 2];

      const dh =
        bbox[bboxIndex + 3];

      const centerX =
        dx * stride +
        gridX * stride;

      const centerY =
        dy * stride +
        gridY * stride;

      const width =
        Math.exp(dw) *
        stride;

      const height =
        Math.exp(dh) *
        stride;

      let xmin =
        centerX -
        width / 2;

      let ymin =
        centerY -
        height / 2;

      let xmax =
        centerX +
        width / 2;

      let ymax =
        centerY +
        height / 2;

      xmin =
        (xmin - offsetX) /
        scale;

      ymin =
        (ymin - offsetY) /
        scale;

      xmax =
        (xmax - offsetX) /
        scale;

      ymax =
        (ymax - offsetY) /
        scale;

      xmin =
        Math.max(
          0,
          Math.min(
            originalWidth,
            xmin
          )
        );

      ymin =
        Math.max(
          0,
          Math.min(
            originalHeight,
            ymin
          )
        );

      xmax =
        Math.max(
          0,
          Math.min(
            originalWidth,
            xmax
          )
        );

      ymax =
        Math.max(
          0,
          Math.min(
            originalHeight,
            ymax
          )
        );

      if (
        xmax <= xmin ||
        ymax <= ymin
      ) {
        continue;
      }

      boxes.push({
        xmin,
        ymin,
        xmax,
        ymax,
        confidence,
      });
    }
  }

  return applyNMS(boxes);
}

// ----------------------------------------
// IoU
// ----------------------------------------

function calculateIoU(
  a: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  },
  b: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  }
): number {
  const intersectionXMin =
    Math.max(
      a.xmin,
      b.xmin
    );

  const intersectionYMin =
    Math.max(
      a.ymin,
      b.ymin
    );

  const intersectionXMax =
    Math.min(
      a.xmax,
      b.xmax
    );

  const intersectionYMax =
    Math.min(
      a.ymax,
      b.ymax
    );

  const intersectionWidth =
    Math.max(
      0,
      intersectionXMax -
        intersectionXMin
    );

  const intersectionHeight =
    Math.max(
      0,
      intersectionYMax -
        intersectionYMin
    );

  const intersectionArea =
    intersectionWidth *
    intersectionHeight;

  const areaA =
    (a.xmax - a.xmin) *
    (a.ymax - a.ymin);

  const areaB =
    (b.xmax - b.xmin) *
    (b.ymax - b.ymin);

  const unionArea =
    areaA +
    areaB -
    intersectionArea;

  if (unionArea <= 0) {
    return 0;
  }

  return (
    intersectionArea /
    unionArea
  );
}

// ----------------------------------------
// Non-Maximum Suppression
// ----------------------------------------

function applyNMS(
  boxes: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    confidence: number;
  }[]
): YuNetDetection[] {
  boxes.sort(
    (a, b) =>
      b.confidence -
      a.confidence
  );

  const kept: typeof boxes =
    [];

  for (
    const box of boxes
  ) {
    let suppressed =
      false;

    for (
      const existing of kept
    ) {
      const iou =
        calculateIoU(
          box,
          existing
        );

      if (
        iou >=
        NMS_THRESHOLD
      ) {
        suppressed = true;
        break;
      }
    }

    if (!suppressed) {
      kept.push(box);
    }
  }

  return kept.map(
    (box) => ({
      label: "face",

      confidence:
        box.confidence,

      bbox: {
        xmin: box.xmin,
        ymin: box.ymin,
        xmax: box.xmax,
        ymax: box.ymax,
      },
    })
  );
}

// ----------------------------------------
// Public detection function
// ----------------------------------------

export async function detectYuNet(
  image: HTMLImageElement
): Promise<YuNetDetection[]> {
  const detector =
    await getYuNetSession();

  const {
    tensor,
    scale,
    offsetX,
    offsetY,
  } =
    createInputTensor(
      image
    );

  const start =
    performance.now();

  const outputs =
    await detector.run({
      input: tensor,
    });

  const inferenceTime =
    performance.now() -
    start;

  console.log(
    `YuNet inference: ${inferenceTime.toFixed(2)} ms`
  );

  const detections =
    decodeOutputs(
      outputs,
      scale,
      offsetX,
      offsetY,
      image.naturalWidth,
      image.naturalHeight
    );

  console.log(
    "YuNet detections:",
    detections
  );

  return detections;
}