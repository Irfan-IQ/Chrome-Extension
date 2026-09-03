import { pipeline, RawImage } from "@huggingface/transformers";

export type Detection = {
  label: string;
  confidence: number;
  bbox: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  };
};

let detector: any = null;
let detectorBackend: "webgpu" | "wasm" | null = null;

async function createDetector() {
  // Try WebGPU first.
  if ("gpu" in navigator) {
    try {
      console.log("Trying YOLOS-Tiny with WebGPU...");

      const webgpuDetector = await pipeline(
        "object-detection",
        "Xenova/yolos-tiny",
        {
          device: "webgpu",
          dtype: "q8",
        }
      );

      detectorBackend = "webgpu";

      console.log("YOLOS-Tiny running with WebGPU.");

      return webgpuDetector;
    } catch (error) {
      console.warn(
        "WebGPU initialization failed. Falling back to WASM.",
        error
      );
    }
  }

  // WASM fallback.
  console.log("Loading YOLOS-Tiny with WASM...");

  const wasmDetector = await pipeline(
    "object-detection",
    "Xenova/yolos-tiny",
    {
      device: "wasm",
      dtype: "q8",
    }
  );

  detectorBackend = "wasm";

  console.log("YOLOS-Tiny running with WASM.");

  return wasmDetector;
}

async function getDetector() {
  if (!detector) {
    detector = await createDetector();
  }

  return detector;
}

export function getDetectorBackend() {
  return detectorBackend;
}

export async function detectObjects(
  image: HTMLImageElement
): Promise<Detection[]> {
  const detectorInstance = await getDetector();

  const tempCanvas = document.createElement("canvas");

  tempCanvas.width = image.naturalWidth;
  tempCanvas.height = image.naturalHeight;

  const tempCtx = tempCanvas.getContext("2d");

  if (!tempCtx) {
    throw new Error("Could not create canvas context");
  }

  tempCtx.drawImage(image, 0, 0);

  const rawImage = RawImage.fromCanvas(tempCanvas);

  // Keep this low so that we don't lose
  // 70–90% confidence detections before
  // the red-outline logic sees them.
  const results = await detectorInstance(
    rawImage,
    {
      threshold: 0.3,
    }
  );

  return results.map((result: any) => ({
    label: result.label,
    confidence: result.score,
    bbox: {
      xmin: result.box.xmin,
      ymin: result.box.ymin,
      xmax: result.box.xmax,
      ymax: result.box.ymax,
    },
  }));
}