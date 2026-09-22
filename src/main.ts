import "./style.css";

import {
  detectObjects,
  type Detection,
} from "./detector";

import {
  detectYuNet,
} from "./yunet-detector";


const fileInput =
  document.getElementById("imageInput") as HTMLInputElement;

const runButton =
  document.getElementById("runDetection") as HTMLButtonElement;

const status =
  document.getElementById("status") as HTMLParagraphElement;


// ============================================================
// CANVASES
// ============================================================

const yolosCanvas =
  document.getElementById("yolosCanvas") as HTMLCanvasElement;

const yolosCtx =
  yolosCanvas.getContext("2d");

if (!yolosCtx) {
  throw new Error("Could not get YOLOS canvas context");
}


const yunetCanvas =
  document.getElementById("yunetCanvas") as HTMLCanvasElement;

const yunetCtx =
  yunetCanvas.getContext("2d");

if (!yunetCtx) {
  throw new Error("Could not get YuNet canvas context");
}


// ============================================================
// STATE
// ============================================================

let image: HTMLImageElement | null = null;


// Both models can trigger privacy handling,
// but they detect different things.
//
// YOLOS → person
// YuNet → face
//
const SENSITIVE_LABELS = new Set([
  "person",
  "face",
]);


const PERSON_PADDING_X = 10;
const PERSON_PADDING_Y = 20;

const FACE_PADDING_X = 20;
const FACE_PADDING_Y = 20;


// ============================================================
// HELPERS
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


function calculateStatistics(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);

  const sum =
    sorted.reduce(
      (total, value) => total + value,
      0
    );

  const mean =
    sum / sorted.length;


  const percentile = (
    values: number[],
    percentileValue: number
  ) => {

    const index =
      (percentileValue / 100) *
      (values.length - 1);

    const lower =
      Math.floor(index);

    const upper =
      Math.ceil(index);

    if (lower === upper) {
      return values[lower];
    }

    const weight =
      index - lower;

    return (
      values[lower] * (1 - weight) +
      values[upper] * weight
    );
  };


  return {
    min: sorted[0],
    mean,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    max: sorted[sorted.length - 1],
  };
}


function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}


// ============================================================
// FILE SELECTION
// ============================================================

fileInput.addEventListener("change", () => {

  const file =
    fileInput.files?.[0];

  if (!file) return;


  const url =
    URL.createObjectURL(file);

  const selectedImage =
    new Image();


  selectedImage.onload = () => {

    image = selectedImage;


    yolosCanvas.width =
      selectedImage.naturalWidth;

    yolosCanvas.height =
      selectedImage.naturalHeight;


    yunetCanvas.width =
      selectedImage.naturalWidth;

    yunetCanvas.height =
      selectedImage.naturalHeight;


    yolosCtx.clearRect(
      0,
      0,
      yolosCanvas.width,
      yolosCanvas.height
    );


    yunetCtx.clearRect(
      0,
      0,
      yunetCanvas.width,
      yunetCanvas.height
    );


    yolosCtx.drawImage(
      selectedImage,
      0,
      0
    );


    yunetCtx.drawImage(
      selectedImage,
      0,
      0
    );


    status.textContent =
      "Image loaded. Ready for benchmark.";


    document.getElementById(
      "yolosStatus"
    )!.textContent = "Ready";


    document.getElementById(
      "yunetStatus"
    )!.textContent = "Ready";


    URL.revokeObjectURL(url);
  };


  selectedImage.onerror = () => {

    image = null;

    status.textContent =
      "Failed to load image.";

    URL.revokeObjectURL(url);
  };


  selectedImage.src = url;
});


// ============================================================
// YOLOS BENCHMARK
// ============================================================

async function benchmarkYOLOS(
  testImage: HTMLImageElement
) {

  console.log(
    "========================================"
  );

  console.log(
    "YOLOS BENCHMARK"
  );

  console.log(
    "========================================"
  );


  // ----------------------------------------------------------
  // Cold run
  // ----------------------------------------------------------

  console.log(
    "YOLOS cold run starting..."
  );


  const coldStart =
    performance.now();


  const coldDetections =
    await detectObjects(testImage);


  const coldTime =
    performance.now() - coldStart;


  console.log(
    `YOLOS cold start: ${coldTime.toFixed(2)} ms`
  );


  // ----------------------------------------------------------
  // Warmup
  // ----------------------------------------------------------

  console.log(
    "YOLOS warmup starting..."
  );


  for (let i = 0; i < 3; i++) {

    const warmupStart =
      performance.now();


    await detectObjects(testImage);


    const warmupTime =
      performance.now() - warmupStart;


    console.log(
      `YOLOS warmup ${i + 1}: ${warmupTime.toFixed(2)} ms`
    );
  }


  // ----------------------------------------------------------
  // Benchmark
  // ----------------------------------------------------------

  console.log(
    "YOLOS benchmark runs starting..."
  );


  const times: number[] = [];

  let finalDetections =
    coldDetections;


  for (let i = 0; i < 10; i++) {

    const start =
      performance.now();


    const detections =
      await detectObjects(testImage);


    const elapsed =
      performance.now() - start;


    times.push(elapsed);

    finalDetections =
      detections;


    console.log(
      `YOLOS run ${i + 1}: ${elapsed.toFixed(2)} ms`
    );


    // Give browser event loop a moment.
    await sleep(20);
  }


  const statistics =
    calculateStatistics(times);


  console.log(
    "YOLOS statistics:",
    statistics
  );


  return {
    coldTime,
    statistics,
    detections: finalDetections,
  };
}


// ============================================================
// YUNET BENCHMARK
// ============================================================

async function benchmarkYuNet(
  testImage: HTMLImageElement
) {

  console.log(
    "========================================"
  );

  console.log(
    "YUNET BENCHMARK"
  );

  console.log(
    "========================================"
  );


  // ----------------------------------------------------------
  // Cold run
  // ----------------------------------------------------------

  console.log(
    "YuNet cold run starting..."
  );


  const coldStart =
    performance.now();


  const coldDetections =
    await detectYuNet(testImage);


  const coldTime =
    performance.now() - coldStart;


  console.log(
    `YuNet cold start: ${coldTime.toFixed(2)} ms`
  );


  // ----------------------------------------------------------
  // Warmup
  // ----------------------------------------------------------

  console.log(
    "YuNet warmup starting..."
  );


  for (let i = 0; i < 3; i++) {

    const warmupStart =
      performance.now();


    await detectYuNet(testImage);


    const warmupTime =
      performance.now() - warmupStart;


    console.log(
      `YuNet warmup ${i + 1}: ${warmupTime.toFixed(2)} ms`
    );
  }


  // ----------------------------------------------------------
  // Benchmark
  // ----------------------------------------------------------

  console.log(
    "YuNet benchmark runs starting..."
  );


  const times: number[] = [];

  let finalDetections =
    coldDetections;


  for (let i = 0; i < 10; i++) {

    const start =
      performance.now();


    const detections =
      await detectYuNet(testImage);


    const elapsed =
      performance.now() - start;


    times.push(elapsed);

    finalDetections =
      detections;


    console.log(
      `YuNet run ${i + 1}: ${elapsed.toFixed(2)} ms`
    );


    await sleep(20);
  }


  const statistics =
    calculateStatistics(times);


  console.log(
    "YuNet statistics:",
    statistics
  );


  return {
    coldTime,
    statistics,
    detections: finalDetections,
  };
}


// ============================================================
// DRAW YOLOS REDACTION
// ============================================================

function drawYOLOSResults(
  detections: Detection[]
) {

  yolosCtx.clearRect(
    0,
    0,
    yolosCanvas.width,
    yolosCanvas.height
  );


  if (!image) return;


  yolosCtx.drawImage(
    image,
    0,
    0
  );


  let redactedCount = 0;
  let warningCount = 0;


  const displayedDetections =
    detections.filter((detection) => {

      if (
        detection.label === "person"
      ) {
        return detection.confidence >= 0.75;
      }

      return detection.confidence >= 0.80;
    });


  for (
    const detection of detections
  ) {

    let {
      xmin,
      ymin,
      xmax,
      ymax,
    } = detection.bbox;


    const confidence =
      detection.confidence;


    if (
      detection.label !== "person"
    ) {
      continue;
    }


    xmin -= PERSON_PADDING_X;
    ymin -= PERSON_PADDING_Y;

    xmax += PERSON_PADDING_X;
    ymax += PERSON_PADDING_Y;


    xmin = Math.max(0, xmin);
    ymin = Math.max(0, ymin);

    xmax = Math.min(
      yolosCanvas.width,
      xmax
    );

    ymax = Math.min(
      yolosCanvas.height,
      ymax
    );


    const width =
      xmax - xmin;

    const height =
      ymax - ymin;


    if (confidence >= 0.90) {

      yolosCtx.fillStyle =
        "black";

      yolosCtx.fillRect(
        xmin,
        ymin,
        width,
        height
      );

      redactedCount++;

    } else if (
      confidence >= 0.70
    ) {

      yolosCtx.strokeStyle =
        "red";

      yolosCtx.lineWidth =
        4;

      yolosCtx.strokeRect(
        xmin,
        ymin,
        width,
        height
      );

      warningCount++;
    }
  }


  document.getElementById(
    "yolosDetected"
  )!.textContent =
    String(displayedDetections.length);


  document.getElementById(
    "yolosRedacted"
  )!.textContent =
    String(redactedCount);


  document.getElementById(
    "yolosWarnings"
  )!.textContent =
    String(warningCount);


  const results =
    document.getElementById(
      "yolosResults"
    )!;


  results.innerHTML = "";


  for (
    const detection of displayedDetections
  ) {

    let action =
      "Kept";


    if (
      detection.label === "person"
    ) {

      if (
        detection.confidence >= 0.90
      ) {
        action = "Redacted";

      } else if (
        detection.confidence >= 0.70
      ) {
        action = "Warning";
      }
    }


    const element =
      document.createElement("div");


    element.className =
      "detection";


    element.innerHTML = `
      <div class="detection-left">
        <strong>${detection.label}</strong>

        <span class="confidence">
          ${(detection.confidence * 100).toFixed(1)}%
        </span>
      </div>

      <span class="action ${action.toLowerCase()}">
        ${action}
      </span>
    `;


    results.appendChild(element);
  }
}


// ============================================================
// DRAW YUNET REDACTION
// ============================================================

function drawYuNetResults(
  detections: Awaited<
    ReturnType<typeof detectYuNet>
  >
) {

  yunetCtx.clearRect(
    0,
    0,
    yunetCanvas.width,
    yunetCanvas.height
  );


  if (!image) return;


  yunetCtx.drawImage(
    image,
    0,
    0
  );


  let redactedCount = 0;
  let warningCount = 0;


  for (
    const detection of detections
  ) {

    if (
      detection.label !== "face"
    ) {
      continue;
    }


    let {
      xmin,
      ymin,
      xmax,
      ymax,
    } = detection.bbox;


    const confidence =
      detection.confidence;


    xmin -= FACE_PADDING_X;
    ymin -= FACE_PADDING_Y;

    xmax += FACE_PADDING_X;
    ymax += FACE_PADDING_Y;


    xmin = Math.max(0, xmin);
    ymin = Math.max(0, ymin);

    xmax = Math.min(
      yunetCanvas.width,
      xmax
    );

    ymax = Math.min(
      yunetCanvas.height,
      ymax
    );


    const width =
      xmax - xmin;

    const height =
      ymax - ymin;


    if (confidence >= 0.90) {

      yunetCtx.fillStyle =
        "black";

      yunetCtx.fillRect(
        xmin,
        ymin,
        width,
        height
      );

      redactedCount++;

    } else if (
      confidence >= 0.70
    ) {

      yunetCtx.strokeStyle =
        "red";

      yunetCtx.lineWidth =
        4;

      yunetCtx.strokeRect(
        xmin,
        ymin,
        width,
        height
      );

      warningCount++;
    }
  }


  document.getElementById(
    "yunetDetected"
  )!.textContent =
    String(detections.length);


  document.getElementById(
    "yunetRedacted"
  )!.textContent =
    String(redactedCount);


  document.getElementById(
    "yunetWarnings"
  )!.textContent =
    String(warningCount);


  const results =
    document.getElementById(
      "yunetResults"
    )!;


  results.innerHTML = "";


  for (
    const detection of detections
  ) {

    let action =
      "Kept";


    if (
      detection.confidence >= 0.90
    ) {

      action =
        "Redacted";

    } else if (
      detection.confidence >= 0.70
    ) {

      action =
        "Warning";
    }


    const element =
      document.createElement("div");


    element.className =
      "detection";


    element.innerHTML = `
      <div class="detection-left">
        <strong>${detection.label}</strong>

        <span class="confidence">
          ${(detection.confidence * 100).toFixed(1)}%
        </span>
      </div>

      <span class="action ${action.toLowerCase()}">
        ${action}
      </span>
    `;


    results.appendChild(element);
  }
}


// ============================================================
// RUN BENCHMARK
// ============================================================

runButton.addEventListener(
  "click",
  async () => {

    if (!image) {

      status.textContent =
        "Please select an image first.";

      return;
    }


    try {

      runButton.disabled = true;


      // ------------------------------------------------------
      // YOLOS
      // ------------------------------------------------------

      status.textContent =
        "Benchmarking YOLOS...";


      document.getElementById(
        "yolosStatus"
      )!.textContent =
        "Benchmarking...";


      const yolosResult =
        await benchmarkYOLOS(image);


      document.getElementById(
        "yolosStatus"
      )!.textContent =
        "Complete";


      document.getElementById(
        "yolosCold"
      )!.textContent =
        formatMs(
          yolosResult.coldTime
        );


      document.getElementById(
        "yolosP50"
      )!.textContent =
        formatMs(
          yolosResult.statistics.p50
        );


      document.getElementById(
        "yolosP90"
      )!.textContent =
        formatMs(
          yolosResult.statistics.p90
        );


      drawYOLOSResults(
        yolosResult.detections
      );


      // ------------------------------------------------------
      // YuNet
      // ------------------------------------------------------

      status.textContent =
        "Benchmarking YuNet...";


      document.getElementById(
        "yunetStatus"
      )!.textContent =
        "Benchmarking...";


      const yunetResult =
        await benchmarkYuNet(image);


      document.getElementById(
        "yunetStatus"
      )!.textContent =
        "Complete";


      document.getElementById(
        "yunetCold"
      )!.textContent =
        formatMs(
          yunetResult.coldTime
        );


      document.getElementById(
        "yunetP50"
      )!.textContent =
        formatMs(
          yunetResult.statistics.p50
        );


      document.getElementById(
        "yunetP90"
      )!.textContent =
        formatMs(
          yunetResult.statistics.p90
        );


      drawYuNetResults(
        yunetResult.detections
      );


      // ------------------------------------------------------
      // Final console report
      // ------------------------------------------------------

      console.log(
        "========================================"
      );

      console.log(
        "FINAL BENCHMARK REPORT"
      );

      console.log(
        "========================================"
      );


      console.log(
        "YOLOS:",
        {
          coldStartMs:
            yolosResult.coldTime,

          minMs:
            yolosResult.statistics.min,

          meanMs:
            yolosResult.statistics.mean,

          p50Ms:
            yolosResult.statistics.p50,

          p90Ms:
            yolosResult.statistics.p90,

          maxMs:
            yolosResult.statistics.max,
        }
      );


      console.log(
        "YuNet:",
        {
          coldStartMs:
            yunetResult.coldTime,

          minMs:
            yunetResult.statistics.min,

          meanMs:
            yunetResult.statistics.mean,

          p50Ms:
            yunetResult.statistics.p50,

          p90Ms:
            yunetResult.statistics.p90,

          maxMs:
            yunetResult.statistics.max,
        }
      );


      status.textContent =
        "Benchmark complete. Check the performance panels and console for the full report.";

    } catch (error) {

      console.error(error);

      status.textContent =
        "Benchmark failed. Check the console.";

    } finally {

      runButton.disabled = false;
    }
  }
);