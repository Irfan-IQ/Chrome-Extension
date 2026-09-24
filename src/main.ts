import "./style.css";

import {
  detectYuNet,
  type YuNetDetection,
} from "./yunet-detector";

const fileInput =
  document.getElementById(
    "imageInput"
  ) as HTMLInputElement;

const runButton =
  document.getElementById(
    "runDetection"
  ) as HTMLButtonElement;

const status =
  document.getElementById(
    "status"
  ) as HTMLParagraphElement;

const yunetCanvas =
  document.getElementById(
    "yunetCanvas"
  ) as HTMLCanvasElement;

const yunetCtx =
  yunetCanvas.getContext("2d");

if (!yunetCtx) {
  throw new Error(
    "Could not get YuNet canvas context"
  );
}

// ============================================================
// PRIVACY CONFIGURATION
// ============================================================

// Candidate detections below this value are ignored by the
// privacy layer.
//
// YuNet itself still produces candidates from SCORE_THRESHOLD
// inside yunet-detector.ts.
//
// This is the actual privacy/redaction threshold.
const FACE_REDACTION_THRESHOLD = 0.70;

const FACE_PADDING_X = 20;
const FACE_PADDING_Y = 20;

// ============================================================
// STATE
// ============================================================

let image:
  HTMLImageElement | null = null;

// ============================================================
// HELPERS
// ============================================================

function sleep(
  ms: number
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms
      );
    }
  );
}

function calculateStatistics(
  times: number[]
) {
  const sorted =
    [...times].sort(
      (a, b) => a - b
    );

  const sum =
    sorted.reduce(
      (total, value) =>
        total + value,
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

    if (
      lower === upper
    ) {
      return values[lower];
    }

    const weight =
      index - lower;

    return (
      values[lower] *
        (1 - weight) +
      values[upper] *
        weight
    );
  };

  return {
    min: sorted[0],
    mean,
    p50: percentile(
      sorted,
      50
    ),
    p90: percentile(
      sorted,
      90
    ),
    max:
      sorted[
        sorted.length - 1
      ],
  };
}

function formatMs(
  value: number
): string {
  return `${value.toFixed(2)} ms`;
}

// ============================================================
// FILE SELECTION
// ============================================================

fileInput.addEventListener(
  "change",
  () => {
    const file =
      fileInput.files?.[0];

    if (!file) {
      return;
    }

    const url =
      URL.createObjectURL(
        file
      );

    const selectedImage =
      new Image();

    selectedImage.onload =
      () => {
        image =
          selectedImage;

        yunetCanvas.width =
          selectedImage.naturalWidth;

        yunetCanvas.height =
          selectedImage.naturalHeight;

        yunetCtx.clearRect(
          0,
          0,
          yunetCanvas.width,
          yunetCanvas.height
        );

        yunetCtx.drawImage(
          selectedImage,
          0,
          0
        );

        status.textContent =
          "Image loaded. Ready to detect faces.";

        document.getElementById(
          "yunetStatus"
        )!.textContent =
          "Ready";

        URL.revokeObjectURL(
          url
        );
      };

    selectedImage.onerror =
      () => {
        image = null;

        status.textContent =
          "Failed to load image.";

        URL.revokeObjectURL(
          url
        );
      };

    selectedImage.src =
      url;
  }
);

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
    await detectYuNet(
      testImage
    );

  const coldTime =
    performance.now() -
    coldStart;

  console.log(
    `YuNet cold start: ${coldTime.toFixed(2)} ms`
  );

  // ----------------------------------------------------------
  // Warmup
  // ----------------------------------------------------------

  console.log(
    "YuNet warmup starting..."
  );

  for (
    let i = 0;
    i < 3;
    i++
  ) {
    const warmupStart =
      performance.now();

    await detectYuNet(
      testImage
    );

    const warmupTime =
      performance.now() -
      warmupStart;

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

  for (
    let i = 0;
    i < 10;
    i++
  ) {
    const start =
      performance.now();

    const detections =
      await detectYuNet(
        testImage
      );

    const elapsed =
      performance.now() -
      start;

    times.push(
      elapsed
    );

    finalDetections =
      detections;

    console.log(
      `YuNet run ${i + 1}: ${elapsed.toFixed(2)} ms`
    );

    await sleep(20);
  }

  const statistics =
    calculateStatistics(
      times
    );

  console.log(
    "YuNet statistics:",
    statistics
  );

  return {
    coldTime,
    statistics,
    detections:
      finalDetections,
  };
}

// ============================================================
// REDACT FACES
// ============================================================

function drawYuNetResults(
  detections: YuNetDetection[]
) {
  if (!image) {
    return;
  }

  yunetCtx.clearRect(
    0,
    0,
    yunetCanvas.width,
    yunetCanvas.height
  );

  // Start with the original image.
  yunetCtx.drawImage(
    image,
    0,
    0
  );

  let redactedCount =
    0;

  // Only detections above the privacy threshold
  // are allowed to trigger redaction.
  const redactedDetections =
    detections.filter(
      (detection) =>
        detection.label ===
          "face" &&
        detection.confidence >=
          FACE_REDACTION_THRESHOLD
    );

  for (
    const detection of redactedDetections
  ) {
    let {
      xmin,
      ymin,
      xmax,
      ymax,
    } =
      detection.bbox;

    xmin -=
      FACE_PADDING_X;

    ymin -=
      FACE_PADDING_Y;

    xmax +=
      FACE_PADDING_X;

    ymax +=
      FACE_PADDING_Y;

    xmin =
      Math.max(
        0,
        xmin
      );

    ymin =
      Math.max(
        0,
        ymin
      );

    xmax =
      Math.min(
        yunetCanvas.width,
        xmax
      );

    ymax =
      Math.min(
        yunetCanvas.height,
        ymax
      );

    const width =
      xmax - xmin;

    const height =
      ymax - ymin;

    // --------------------------------------
    // ACTUAL PRIVACY REDACTION
    // --------------------------------------

    yunetCtx.fillStyle =
      "black";

    yunetCtx.fillRect(
      xmin,
      ymin,
      width,
      height
    );

    redactedCount++;
  }

  // ==========================================================
  // STATISTICS
  // ==========================================================

  document.getElementById(
    "yunetDetected"
  )!.textContent =
    String(
      detections.length
    );

  document.getElementById(
    "yunetRedacted"
  )!.textContent =
    String(
      redactedCount
    );

  // ==========================================================
  // RESULT LIST
  // ==========================================================

  const results =
    document.getElementById(
      "yunetResults"
    )!;

  results.innerHTML =
    "";

  for (
    const detection of detections
  ) {
    const isRedacted =
      detection.confidence >=
      FACE_REDACTION_THRESHOLD;

    const action =
      isRedacted
        ? "Redacted"
        : "Kept";

    const actionClass =
      isRedacted
        ? "redacted"
        : "kept";

    const element =
      document.createElement(
        "div"
      );

    element.className =
      "detection";

    element.innerHTML = `
      <div class="detection-left">
        <strong>${detection.label}</strong>

        <span class="confidence">
          ${(detection.confidence * 100).toFixed(1)}%
        </span>
      </div>

      <span class="action ${actionClass}">
        ${action}
      </span>
    `;

    results.appendChild(
      element
    );
  }
}

// ============================================================
// RUN DETECTION
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
      runButton.disabled =
        true;

      status.textContent =
        "Running YuNet face detection...";

      document.getElementById(
        "yunetStatus"
      )!.textContent =
        "Detecting...";

      const result =
        await benchmarkYuNet(
          image
        );

      document.getElementById(
        "yunetStatus"
      )!.textContent =
        "Complete";

      document.getElementById(
        "yunetCold"
      )!.textContent =
        formatMs(
          result.coldTime
        );

      document.getElementById(
        "yunetP50"
      )!.textContent =
        formatMs(
          result.statistics.p50
        );

      document.getElementById(
        "yunetP90"
      )!.textContent =
        formatMs(
          result.statistics.p90
        );

      drawYuNetResults(
        result.detections
      );

      status.textContent =
        `YuNet complete. Redaction threshold: ${(FACE_REDACTION_THRESHOLD * 100).toFixed(0)}%.`;

    } catch (error) {
      console.error(
        "YuNet failed:",
        error
      );

      status.textContent =
        "YuNet detection failed. Check the console.";

      document.getElementById(
        "yunetStatus"
      )!.textContent =
        "Error";
    } finally {
      runButton.disabled =
        false;
    }
  }
);