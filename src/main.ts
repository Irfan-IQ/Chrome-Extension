import {
  detectObjects,
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

const PERSON_PADDING_X = 15;
const PERSON_PADDING_Y = 30;

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];

  if (!file) {
    return;
  }

  const url = URL.createObjectURL(file);

  image = new Image();

  image.onload = () => {
    canvas.width = image!.naturalWidth;
    canvas.height = image!.naturalHeight;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      image!,
      0,
      0
    );

    resultsContainer.innerHTML = "";

    status.textContent =
      "Image loaded. Ready for detection.";

    URL.revokeObjectURL(url);
  };

  image.onerror = () => {
    image = null;

    status.textContent =
      "Failed to load image.";

    URL.revokeObjectURL(url);
  };

  image.src = url;
});

runButton.addEventListener("click", async () => {
  if (!image) {
    status.textContent =
      "Please select an image first.";

    return;
  }

  try {
    runButton.disabled = true;

    status.textContent =
      "Running YOLOS-Tiny...";

    const detections: Detection[] =
      await detectObjects(image);

    // Redraw original image.
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

    for (const detection of detections) {
      let {
        xmin,
        ymin,
        xmax,
        ymax,
      } = detection.bbox;

      const isSensitive =
        SENSITIVE_LABELS.has(
          detection.label
        );

      // Only expand person detections.
      if (detection.label === "person") {
        xmin -= PERSON_PADDING_X;
        ymin -= PERSON_PADDING_Y;
        xmax += PERSON_PADDING_X;
        ymax += PERSON_PADDING_Y;

        xmin = Math.max(0, xmin);
        ymin = Math.max(0, ymin);
        xmax = Math.min(canvas.width, xmax);
        ymax = Math.min(canvas.height, ymax);
      }

      const width = xmax - xmin;
      const height = ymax - ymin;

      // Redact sensitive detections.
      if (isSensitive) {
        ctx.fillStyle = "black";

        ctx.fillRect(
          xmin,
          ymin,
          width,
          height
        );

        redactedCount++;
      }

      // Show detection information.
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
          ${isSensitive ? "REDACTED" : "KEPT"}
        </p>
      `;

      resultsContainer.appendChild(
        detectionElement
      );
    }

    status.textContent =
      `Detection complete. ` +
      `Found ${detections.length} object(s). ` +
      `${redactedCount} sensitive object(s) redacted.`;

  } catch (error) {
    console.error(error);

    status.textContent =
      "Detection failed. Check the browser console.";
  } finally {
    runButton.disabled = false;
  }
});