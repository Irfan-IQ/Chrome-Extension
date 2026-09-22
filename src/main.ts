import {
  detectObjects,
  type Detection,
} from "./detector";

import {
  detectYuNet,
} from "./yunet-detector";

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

const detectedCountElement =
  document.getElementById(
    "detectedCount"
  ) as HTMLSpanElement;

const redactedCountElement =
  document.getElementById(
    "redactedCount"
  ) as HTMLSpanElement;

const warningCountElement =
  document.getElementById(
    "warningCount"
  ) as HTMLSpanElement;

const resultsContainer =
  document.getElementById(
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

    canvas.width =
      selectedImage.naturalWidth;

    canvas.height =
      selectedImage.naturalHeight;

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

    detectedCountElement.textContent = "0";
    redactedCountElement.textContent = "0";
    warningCountElement.textContent = "0";

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
// Run detection
// ----------------------------------------

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

      status.textContent =
        "Running detection...";

      const yunetDetections =
  await detectYuNet(image);

const detections: Detection[] =
  yunetDetections;

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

      // ------------------------------------
      // Objects shown in the detection list
      //
      // Person: >= 75%
      // Other:  >= 80%
      // ------------------------------------

      const displayedDetections =
        detections.filter(
          (detection) => {
            if (
              detection.label === "person"
            ) {
              return (
                detection.confidence >= 0.75
              );
            }

            return (
              detection.confidence >= 0.80
            );
          }
        );

      detectedCountElement.textContent =
        String(displayedDetections.length);

      // ------------------------------------
      // Draw privacy overlays
      // ------------------------------------

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

        // Only person detections receive
        // privacy treatment.
        if (!isSensitive) {
          continue;
        }

        // Slight padding around persons.
        if (
          detection.label === "person"
        ) {
          xmin -= PERSON_PADDING_X;
          ymin -= PERSON_PADDING_Y;
          xmax += PERSON_PADDING_X;
          ymax += PERSON_PADDING_Y;
        }

        // Keep coordinates inside canvas.
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
        // >= 90% → black redaction
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
        // 70%–89.99% → red outline
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
      }

      // ------------------------------------
      // Update counts
      // ------------------------------------

      redactedCountElement.textContent =
        String(redactedCount);

      warningCountElement.textContent =
        String(warningCount);

      // ------------------------------------
      // Detection list
      // ------------------------------------

      for (const detection of displayedDetections) {
        const {
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

        let action = "Kept";

        if (isSensitive) {
          if (confidence >= 0.90) {
            action = "Redacted";
          } else if (confidence >= 0.70) {
            action = "Warning";
          }
        }

        const detectionElement =
          document.createElement("div");

        detectionElement.className =
          "detection";

        detectionElement.innerHTML = `
          <div class="detection-left">
            <strong>
              ${detection.label}
            </strong>

            <span class="confidence">
              ${(confidence * 100).toFixed(1)}%
            </span>
          </div>

          <span class="action ${action.toLowerCase()}">
            ${action}
          </span>
        `;

        resultsContainer.appendChild(
          detectionElement
        );
      }

      status.textContent =
        "Detection complete.";

    } catch (error) {
      console.error(error);

      status.textContent =
        "Detection failed. Check the console.";
    } finally {
      runButton.disabled = false;
    }
  }
);