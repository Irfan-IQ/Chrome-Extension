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

async function getDetector() {
  if (detector) {
    return detector;
  }

  const useWebGPU = "gpu" in navigator;

  console.log(
    "Loading YOLOS-Tiny with:",
    useWebGPU ? "WebGPU" : "WASM/CPU"
  );

  detector = await pipeline(
    "object-detection",
    "Xenova/yolos-tiny",
    {
      device: useWebGPU ? "webgpu" : "wasm",
      dtype: "q8",
    }
  );

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

 const results = await detector(rawImage, {
  threshold: 0.3,
});

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