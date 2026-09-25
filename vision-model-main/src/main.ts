import "./style.css";

const fileInput = document.getElementById("imageInput") as HTMLInputElement;
const runButton = document.getElementById("runDetection") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLParagraphElement;
const yunetCanvas = document.getElementById("yunetCanvas") as HTMLCanvasElement;
const opencvCanvas = document.getElementById("opencvCanvas") as HTMLCanvasElement;
const yunetCtx = yunetCanvas.getContext("2d");
const opencvCtx = opencvCanvas.getContext("2d");

if (!yunetCtx || !opencvCtx) {
  throw new Error("Could not create result canvas contexts");
}

const FACE_REDACTION_THRESHOLD = 0.70;
const FACE_PADDING_X = 20;
const FACE_PADDING_Y = 20;
const WARMUP_RUNS = 3;
const BENCHMARK_RUNS = 10;

type YuNetDetection = {
  label: "face";
  confidence: number;
  bbox: { xmin: number; ymin: number; xmax: number; ymax: number };
};

type OpenCVDetection = {
  label: "card_like_quad";
  confidence: number;
  bbox: { xmin: number; ymin: number; xmax: number; ymax: number };
  polygon: number[][];
};

type YuNetResult = {
  detections: YuNetDetection[];
  loadMs: number;
  preprocessMs: number;
  inferenceMs: number;
  postprocessMs: number;
  workerMs: number;
};

type OpenCVResult = {
  detections: OpenCVDetection[];
  workerMs: number;
};

const yunetWorker = new Worker(
  new URL("./yunet.worker.ts", import.meta.url),
  { type: "module" },
);

const opencvWorker = new Worker(
  new URL("./opencv.worker.ts", import.meta.url),
  { type: "module" },
);

let nextRequestId = 1;
let selectedFile: File | null = null;
let selectedImage: HTMLImageElement | null = null;

const pendingYuNet = new Map<number, { resolve: (value: YuNetResult) => void; reject: (reason: unknown) => void }>();
const pendingOpenCV = new Map<number, { resolve: (value: OpenCVResult) => void; reject: (reason: unknown) => void }>();

function attachWorkerHandlers() {
  yunetWorker.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as YuNetResult & { id: number; error?: string };
    const pending = pendingYuNet.get(message.id);
    if (!pending) return;
    pendingYuNet.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error));
      return;
    }

    pending.resolve(message);
  });

  opencvWorker.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as OpenCVResult & { id: number; error?: string };
    const pending = pendingOpenCV.get(message.id);
    if (!pending) return;
    pendingOpenCV.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error));
      return;
    }

    pending.resolve(message);
  });

  const handleWorkerError = (workerName: string) => (event: ErrorEvent) => {
    console.error(`${workerName} worker error`, event.error ?? event.message);
    status.textContent = `${workerName} worker failed. Check the console.`;
  };

  yunetWorker.addEventListener("error", handleWorkerError("YuNet"));
  opencvWorker.addEventListener("error", handleWorkerError("OpenCV"));
}

attachWorkerHandlers();

function calculateStatistics(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const percentile = (values: number[], p: number) => {
    const index = (p / 100) * (values.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return values[lower];
    const weight = index - lower;
    return values[lower] * (1 - weight) + values[upper] * weight;
  };

  return {
    min: sorted[0],
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    max: sorted[sorted.length - 1],
  };
}

function formatMs(value: number) {
  return `${value.toFixed(2)} ms`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function createBitmapFromImage(image: HTMLImageElement): Promise<ImageBitmap> {
  return createImageBitmap(image);
}

function runYuNet(image: ImageBitmap): Promise<YuNetResult> {
  const id = nextRequestId++;
  const promise = new Promise<YuNetResult>((resolve, reject) => {
    pendingYuNet.set(id, { resolve, reject });
  });
  yunetWorker.postMessage({ id, image }, [image]);
  return promise;
}

function runOpenCV(image: ImageBitmap): Promise<OpenCVResult> {
  const id = nextRequestId++;
  const promise = new Promise<OpenCVResult>((resolve, reject) => {
    pendingOpenCV.set(id, { resolve, reject });
  });
  opencvWorker.postMessage({ id, image }, [image]);
  return promise;
}

async function runConcurrentPair(image: HTMLImageElement) {
  const [yunetBitmap, opencvBitmap] = await Promise.all([
    createBitmapFromImage(image),
    createBitmapFromImage(image),
  ]);

  const wallStart = performance.now();

  const [yunet, opencv] = await Promise.all([
    runYuNet(yunetBitmap),
    runOpenCV(opencvBitmap),
  ]);

  const wallMs = performance.now() - wallStart;

  return { yunet, opencv, wallMs };
}

function drawResults(
  image: HTMLImageElement,
  yunet: YuNetDetection[],
  opencv: OpenCVDetection[],
) {
  yunetCanvas.width = image.naturalWidth;
  yunetCanvas.height = image.naturalHeight;
  opencvCanvas.width = image.naturalWidth;
  opencvCanvas.height = image.naturalHeight;

  yunetCtx.clearRect(0, 0, yunetCanvas.width, yunetCanvas.height);
  opencvCtx.clearRect(0, 0, opencvCanvas.width, opencvCanvas.height);
  yunetCtx.drawImage(image, 0, 0);
  opencvCtx.drawImage(image, 0, 0);

  let redactedCount = 0;

  for (const detection of yunet) {
    if (detection.confidence < FACE_REDACTION_THRESHOLD) continue;

    let xmin = Math.max(0, detection.bbox.xmin - FACE_PADDING_X);
    let ymin = Math.max(0, detection.bbox.ymin - FACE_PADDING_Y);
    let xmax = Math.min(image.naturalWidth, detection.bbox.xmax + FACE_PADDING_X);
    let ymax = Math.min(image.naturalHeight, detection.bbox.ymax + FACE_PADDING_Y);

    yunetCtx.fillStyle = "black";
    yunetCtx.fillRect(xmin, ymin, xmax - xmin, ymax - ymin);
    redactedCount++;
  }

  for (const detection of opencv) {
    const { xmin, ymin, xmax, ymax } = detection.bbox;
    opencvCtx.strokeStyle = "#f97316";
    opencvCtx.lineWidth = Math.max(3, image.naturalWidth / 500);
    opencvCtx.strokeRect(xmin, ymin, xmax - xmin, ymax - ymin);

    opencvCtx.fillStyle = "rgba(249, 115, 22, 0.9)";
    opencvCtx.font = `${Math.max(14, image.naturalWidth / 100)}px system-ui`;
    opencvCtx.fillText(
      `card-like quad ${(detection.confidence * 100).toFixed(0)}%`,
      xmin,
      Math.max(18, ymin - 6),
    );
  }

  document.getElementById("yunetDetected")!.textContent = String(yunet.length);
  document.getElementById("yunetRedacted")!.textContent = String(redactedCount);
  document.getElementById("opencvDetected")!.textContent = String(opencv.length);
  document.getElementById("opencvCountStat")!.textContent = String(opencv.length);

  const yunetResults = document.getElementById("yunetResults")!;
  yunetResults.innerHTML = "";
  for (const detection of yunet) {
    const row = document.createElement("div");
    row.className = "detection";
    const redacted = detection.confidence >= FACE_REDACTION_THRESHOLD;
    row.innerHTML = `
      <div class="detection-left">
        <strong>face</strong>
        <span class="confidence">${(detection.confidence * 100).toFixed(1)}%</span>
      </div>
      <span class="action ${redacted ? "redacted" : "kept"}">${redacted ? "Redacted" : "Kept"}</span>
    `;
    yunetResults.appendChild(row);
  }

  const opencvResults = document.getElementById("opencvResults")!;
  opencvResults.innerHTML = "";
  for (const detection of opencv) {
    const row = document.createElement("div");
    row.className = "detection";
    row.innerHTML = `
      <div class="detection-left">
        <strong>card-like quad</strong>
        <span class="confidence">${(detection.confidence * 100).toFixed(1)}%</span>
      </div>
      <span class="action kept">Candidate</span>
    `;
    opencvResults.appendChild(row);
  }
}

function updatePerformance(result: {
  yunetCold: number;
  yunetStats: ReturnType<typeof calculateStatistics>;
  opencvStats: ReturnType<typeof calculateStatistics>;
  combinedStats: ReturnType<typeof calculateStatistics>;
  final: { yunet: YuNetResult; opencv: OpenCVResult };
}) {
  document.getElementById("yunetCold")!.textContent = formatMs(result.yunetCold);
  document.getElementById("yunetP50")!.textContent = formatMs(result.yunetStats.p50);
  document.getElementById("yunetP90")!.textContent = formatMs(result.yunetStats.p90);
  document.getElementById("opencvP50")!.textContent = formatMs(result.opencvStats.p50);
  document.getElementById("opencvP90")!.textContent = formatMs(result.opencvStats.p90);
  document.getElementById("combinedP50")!.textContent = formatMs(result.combinedStats.p50);
  document.getElementById("combinedP90")!.textContent = formatMs(result.combinedStats.p90);

  document.getElementById("yunetWorker")!.textContent = formatMs(result.final.yunet.workerMs);
  document.getElementById("opencvWorker")!.textContent = formatMs(result.final.opencv.workerMs);
}

async function benchmarkConcurrent(image: HTMLImageElement) {
  const coldStart = performance.now();
  const cold = await runConcurrentPair(image);
  const coldWallMs = performance.now() - coldStart;

  console.log("Concurrent cold run", { cold, coldWallMs });

  for (let i = 0; i < WARMUP_RUNS; i++) {
    const warmup = await runConcurrentPair(image);
    console.log(`Concurrent warmup ${i + 1}`, warmup);
  }

  const yunetTimes: number[] = [];
  const opencvTimes: number[] = [];
  const combinedTimes: number[] = [];
  let final = cold;

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    const result = await runConcurrentPair(image);
    yunetTimes.push(result.yunet.workerMs);
    opencvTimes.push(result.opencv.workerMs);
    combinedTimes.push(result.wallMs);
    final = result;

    console.log(`Concurrent run ${i + 1}`, result);
    await sleep(20);
  }

  const report = {
    coldWallMs,
    yunetCold: cold.yunet.loadMs + cold.yunet.workerMs,
    yunetStats: calculateStatistics(yunetTimes),
    opencvStats: calculateStatistics(opencvTimes),
    combinedStats: calculateStatistics(combinedTimes),
    final,
  };

  console.table({
    "YuNet p50": report.yunetStats.p50,
    "YuNet p90": report.yunetStats.p90,
    "OpenCV p50": report.opencvStats.p50,
    "OpenCV p90": report.opencvStats.p90,
    "Combined p50": report.combinedStats.p50,
    "Combined p90": report.combinedStats.p90,
    "Cold wall": report.coldWallMs,
  });

  return report;
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  selectedFile = file;
  const url = URL.createObjectURL(file);
  const nextImage = new Image();

  nextImage.onload = () => {
    selectedImage = nextImage;
    yunetCanvas.width = nextImage.naturalWidth;
    yunetCanvas.height = nextImage.naturalHeight;
    opencvCanvas.width = nextImage.naturalWidth;
    opencvCanvas.height = nextImage.naturalHeight;
    yunetCtx.drawImage(nextImage, 0, 0);
    opencvCtx.drawImage(nextImage, 0, 0);
    status.textContent = "Image loaded. Ready for concurrent detection.";
    document.getElementById("yunetStatus")!.textContent = "Ready";
    document.getElementById("opencvStatus")!.textContent = "Ready";
    URL.revokeObjectURL(url);
  };

  nextImage.onerror = () => {
    selectedImage = null;
    selectedFile = null;
    status.textContent = "Failed to load image.";
    URL.revokeObjectURL(url);
  };

  nextImage.src = url;
});

runButton.addEventListener("click", async () => {
  if (!selectedImage || !selectedFile) {
    status.textContent = "Please select an image first.";
    return;
  }

  runButton.disabled = true;
  document.getElementById("yunetStatus")!.textContent = "Detecting...";
  document.getElementById("opencvStatus")!.textContent = "Detecting...";
  status.textContent = "YuNet and OpenCV are running concurrently...";

  try {
    const report = await benchmarkConcurrent(selectedImage);

    drawResults(selectedImage, report.final.yunet.detections, report.final.opencv.detections);
    updatePerformance(report);

    document.getElementById("yunetStatus")!.textContent = "Complete";
    document.getElementById("opencvStatus")!.textContent = "Complete";
    document.getElementById("combinedP50")!.textContent = formatMs(report.combinedStats.p50);
    document.getElementById("combinedP90")!.textContent = formatMs(report.combinedStats.p90);

    status.textContent = `Concurrent test complete. Combined warm p50: ${formatMs(report.combinedStats.p50)}.`;
  } catch (error) {
    console.error("Concurrent detection failed:", error);
    status.textContent = `Detection failed: ${error instanceof Error ? error.message : String(error)}`;
    document.getElementById("yunetStatus")!.textContent = "Error";
    document.getElementById("opencvStatus")!.textContent = "Error";
  } finally {
    runButton.disabled = false;
  }
});
