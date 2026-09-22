import {
  detectObjects,
  type Detection,
} from "./detector";

import {
  detectYuNet,
  getYuNetSession,
} from "./yunet-detector";

import "./style.css";


const fileInput =
  document.getElementById("imageInput") as HTMLInputElement;

const runButton =
  document.getElementById("runDetection") as HTMLButtonElement;

const status =
  document.getElementById("status") as HTMLParagraphElement;


// YOLOS
const yolosCanvas =
  document.getElementById("yolosCanvas") as HTMLCanvasElement;

const yolosCtx = yolosCanvas.getContext("2d");

if (!yolosCtx) {
  throw new Error("Could not get YOLOS canvas context");
}


// YuNet
const yunetCanvas =
  document.getElementById("yunetCanvas") as HTMLCanvasElement;

const yunetCtx = yunetCanvas.getContext("2d");

if (!yunetCtx) {
  throw new Error("Could not get YuNet canvas context");
}


// Shared state
let image: HTMLImageElement | null = null;


// Privacy policy
const SENSITIVE_LABELS = new Set([
  "person",
  "face",
]);

const PERSON_PADDING_X = 10;
const PERSON_PADDING_Y = 20;

const FACE_PADDING_X = 20;
const FACE_PADDING_Y = 20;


// File selection
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];

  if (!file) return;

  const url = URL.createObjectURL(file);
  const selectedImage = new Image();

  selectedImage.onload = () => {
    image = selectedImage;

    yolosCanvas.width = selectedImage.naturalWidth;
    yolosCanvas.height = selectedImage.naturalHeight;

    yunetCanvas.width = selectedImage.naturalWidth;
    yunetCanvas.height = selectedImage.naturalHeight;

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
      "Image loaded. Ready for comparison.";

    document.getElementById("yolosStatus")!.textContent =
      "Ready";

    document.getElementById("yunetStatus")!.textContent =
      "Ready";

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


// Run both models
runButton.addEventListener("click", async () => {
  if (!image) {
    status.textContent =
      "Please select an image first.";

    return;
  }

  try {
    runButton.disabled = true;

    status.textContent =
      "Running YOLOS and YuNet...";


    // ============================================================
    // YOLOS
    // ============================================================

    document.getElementById("yolosStatus")!.textContent =
      "Running...";

    const yolosStart = performance.now();

    const yolosDetections: Detection[] =
      await detectObjects(image);

    const yolosTotal =
      performance.now() - yolosStart;

    document.getElementById("yolosStatus")!.textContent =
      "Complete";

    document.getElementById("yolosTotal")!.textContent =
      `${yolosTotal.toFixed(2)} ms`;


    // ============================================================
    // YuNet
    // ============================================================

    document.getElementById("yunetStatus")!.textContent =
      "Running...";

    const yunetStart = performance.now();

    const yunetDetections =
      await detectYuNet(image);

    const yunetTotal =
      performance.now() - yunetStart;

    document.getElementById("yunetStatus")!.textContent =
      "Complete";

    document.getElementById("yunetTotal")!.textContent =
      `${yunetTotal.toFixed(2)} ms`;


    // ============================================================
    // Draw results
    // ============================================================

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
      image,
      0,
      0
    );

    yunetCtx.drawImage(
      image,
      0,
      0
    );


    // ============================================================
    // YOLOS results
    // ============================================================

    let yolosRedacted = 0;
    let yolosWarnings = 0;

    const displayedYolos =
      yolosDetections.filter((detection) => {
        if (detection.label === "face") {
          return detection.confidence >= 0.75;
        }

        return detection.confidence >= 0.80;
      });

    for (const detection of yolosDetections) {

      let {
        xmin,
        ymin,
        xmax,
        ymax,
      } = detection.bbox;

      const confidence =
        detection.confidence;

      const isSensitive =
        SENSITIVE_LABELS.has(
          detection.label
        );

      if (!isSensitive) continue;


      if (detection.label === "face") {
        xmin -= FACE_PADDING_X;
        ymin -= FACE_PADDING_Y;
        xmax += FACE_PADDING_X;
        ymax += FACE_PADDING_Y;
      }


      if (detection.label === "face") {
        xmin -= FACE_PADDING_X;
        ymin -= FACE_PADDING_Y;
        xmax += FACE_PADDING_X;
        ymax += FACE_PADDING_Y;
      }

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

        yolosCtx.fillStyle = "black";

        yolosCtx.fillRect(
          xmin,
          ymin,
          width,
          height
        );

        yolosRedacted++;

      } else if (confidence >= 0.70) {

        yolosCtx.strokeStyle = "red";
        yolosCtx.lineWidth = 4;

        yolosCtx.strokeRect(
          xmin,
          ymin,
          width,
          height
        );

        yolosWarnings++;
      }
    }


    // ============================================================
    // YuNet results
    // ============================================================

    let yunetRedacted = 0;
    let yunetWarnings = 0;


    for (const detection of yunetDetections) {

      let {
        xmin,
        ymin,
        xmax,
        ymax,
      } = detection.bbox;

      const confidence =
        detection.confidence;


      if (detection.label !== "face") {
        continue;
      }


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

        yunetCtx.fillStyle = "black";

        yunetCtx.fillRect(
          xmin,
          ymin,
          width,
          height
        );

        yunetRedacted++;

      } else if (confidence >= 0.70) {

        yunetCtx.strokeStyle = "red";
        yunetCtx.lineWidth = 4;

        yunetCtx.strokeRect(
          xmin,
          ymin,
          width,
          height
        );

        yunetWarnings++;
      }
    }


    // ============================================================
    // Update statistics
    // ============================================================

    document.getElementById("yolosDetected")!.textContent =
      String(displayedYolos.length);

    document.getElementById("yolosRedacted")!.textContent =
      String(yolosRedacted);

    document.getElementById("yolosWarnings")!.textContent =
      String(yolosWarnings);


    document.getElementById("yunetDetected")!.textContent =
      String(yunetDetections.length);

    document.getElementById("yunetRedacted")!.textContent =
      String(yunetRedacted);

    document.getElementById("yunetWarnings")!.textContent =
      String(yunetWarnings);


    // ============================================================
    // Results lists
    // ============================================================

    const yolosResults =
      document.getElementById("yolosResults")!;

    const yunetResults =
      document.getElementById("yunetResults")!;

    yolosResults.innerHTML = "";
    yunetResults.innerHTML = "";


    for (const detection of displayedYolos) {

      const isSensitive =
        SENSITIVE_LABELS.has(
          detection.label
        );

      let action = "Kept";

      if (isSensitive) {

        if (detection.confidence >= 0.90) {
          action = "Redacted";
        } else if (detection.confidence >= 0.70) {
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

      yolosResults.appendChild(element);
    }


    for (const detection of yunetDetections) {

      let action = "Kept";

      if (detection.confidence >= 0.90) {
        action = "Redacted";
      } else if (detection.confidence >= 0.70) {
        action = "Warning";
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

      yunetResults.appendChild(element);
    }


    status.textContent =
      "Comparison complete.";

  } catch (error) {

    console.error(error);

    status.textContent =
      "Comparison failed. Check the console.";

  } finally {

    runButton.disabled = false;
  }
});