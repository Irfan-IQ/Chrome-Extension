import {
  detectObjects,
  getDetectorBackend,
  type Detection,
} from "./detector";

const fileInput = document.getElementById(
  "imageInput"
) as HTMLInputElement;

const runButton = document.getElementById(
  "runDetection"
) as HTMLButtonElement;

const canvas = document.getElementById(
  "canvas"
) as HTMLCanvasElement;

const status = document.getElementById(
  "status"
) as HTMLParagraphElement;

const resultsContainer = document.getElementById(
  "results"
) as HTMLDivElement;

const ctx = canvas.getContext("2d");

if (!ctx) {
  throw new Error("Could not get canvas context");
}

let image: HTMLImageElement | null = null;

const SENSITIVE_LABELS = new Set([
  "person",
]);

// Slightly smaller than the previous 15x30 padding.
const PERSON_PADDING_X = 10;
const PERSON_PADDING_Y = 20;

// ----------------------------------------
// Image selection
// ----------------------------------------

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];

  if (!file) {
    return;
  }

  const url = URL.createObjectURL(file);

  const selectedImage = new Image();

  selectedImage.onload = () => {
    image = selectedImage;

    canvas.width = selectedImage.naturalWidth;
    canvas.height = selectedImage.naturalHeight;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      selectedImage,
      0,
      0
    );

    resultsContainer.innerHTML = "";

    status.textContent =
      "Image loaded. Ready for detection.";

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

// ----------------------------------------
// Detection + privacy visualization
// ----------------------------------------

runButton.addEventListener("click", async () => {
  if (!image) {
    status.textContent =
      "Please select an image first.";

    return;
  }

  try {
    runButton.disabled = true;

    status.textContent =
      "Loading YOLOS-Tiny...";

    const detections: Detection[] =
      await detectObjects(image);

    const backend = getDetectorBackend();

    // Restore original image.
    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      image,
      0,
      0
    );

    resultsContainer.innerHTML = "";

    let redactedCount = 0;
    let warningCount = 0;

    // Detection list only shows:
    // person >= 75%
    // everything else >= 80%
    const displayedDetections =
      detections.filter((detection) => {
        if (
          detection.label === "person"
        ) {
          return detection.confidence >= 0.75;
        }

        return detection.confidence >= 0.80;
      });

    // ----------------------------------------
    // Process every model detection for the
    // privacy visualization.
    // ----------------------------------------

    for (const detection of detections) {
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

      // Only sensitive objects receive
      // privacy visualization.
      if (isSensitive) {
        // Slightly reduced padding around person.
        if (
          detection.label === "person"
        ) {
          xmin -= PERSON_PADDING_X;
          ymin -= PERSON_PADDING_Y;
          xmax += PERSON_PADDING_X;
          ymax += PERSON_PADDING_Y;
        }

        // Clamp coordinates.
        xmin = Math.max(
          0,
          xmin
        );

        ymin = Math.max(
          0,
          ymin
        );

        xmax = Math.min(
          canvas.width,
          xmax
        );

        ymax = Math.min(
          canvas.height,
          ymax
        );

        const width =
          xmax - xmin;

        const height =
          ymax - ymin;

        // ----------------------------------
        // 90%+ = full redaction
        // ----------------------------------

        if (confidence >= 0.90) {
          ctx.fillStyle = "black";

          ctx.fillRect(
            xmin,
            ymin,
            width,
            height
          );

          redactedCount++;
        }

        // ----------------------------------
        // 70%–89.99% = red warning outline
        // ----------------------------------

        else if (confidence >= 0.70) {
          ctx.strokeStyle = "red";
          ctx.lineWidth = 4;

          ctx.strokeRect(
            xmin,
            ymin,
            width,
            height
          );

          warningCount++;
        }

        // Below 70% = no privacy visualization.
      }
    }

    // ----------------------------------------
    // Display only qualifying detections.
    // ----------------------------------------

    for (const detection of displayedDetections) {
      const {
        xmin,
        ymin,
        xmax,
        ymax,
      } = detection.bbox;

      const isSensitive =
        SENSITIVE_LABELS.has(
          detection.label
        );

      let action = "KEPT";

      if (isSensitive) {
        if (detection.confidence >= 0.90) {
          action = "REDACTED";
        } else if (
          detection.confidence >= 0.70
        ) {
          action = "WARNING";
        }
      }

      const detectionElement =
        document.createElement("div");

      detectionElement.className =
        "detection";

      detectionElement.innerHTML = `
        <p>
          <strong>Label:</strong>
          ${detection.label}
        </p>

        <p>
          <strong>Confidence:</strong>
          ${(detection.confidence * 100).toFixed(2)}%
        </p>

        <p>
          <strong>Bounding Box:</strong>
          [
            ${Math.round(xmin)},
            ${Math.round(ymin)},
            ${Math.round(xmax)},
            ${Math.round(ymax)}
          ]
        </p>

        <p>
          <strong>Action:</strong>
          ${action}
        </p>
      `;

      resultsContainer.appendChild(
        detectionElement
      );
    }

    // ----------------------------------------
    // Status
    // ----------------------------------------

    status.textContent =
      `Detection complete. ` +
      `Found ${detections.length} object(s). ` +
      `Showing ${displayedDetections.length}. ` +
      `${redactedCount} redacted. ` +
      `${warningCount} warning(s). ` +
      `Backend: ${backend ?? "unknown"}.`;

  } catch (error) {
    console.error(error);

    status.textContent =
      "Detection failed. Check the browser console.";
  } finally {
    runButton.disabled = false;
  }
});