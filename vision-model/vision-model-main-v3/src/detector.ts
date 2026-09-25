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

async function createDetector() {
  // Try WebGPU first.
  if ("gpu" in navigator) {
    try {
      console.log("Trying WebGPU...");

      const webgpuDetector = await pipeline(
        "object-detection",
        "Xenova/yolos-tiny",
        {
          device: "webgpu",
          dtype: "q8",
        }
      );

      console.log("Using WebGPU.");

      return webgpuDetector;
    } catch (error) {
      console.warn(
        "WebGPU failed. Falling back to WASM.",
        error
      );
    }
  }

  // WASM fallback.
  console.log("Using WASM...");

  const wasmDetector = await pipeline(
    "object-detection",
    "Xenova/yolos-tiny",
    {
      device: "wasm",
      dtype: "q8",
    }
  );

  console.log("Using WASM.");

  return wasmDetector;
}

async function getDetector() {
  if (!detector) {
    detector = await createDetector();
  }

  return detector;
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