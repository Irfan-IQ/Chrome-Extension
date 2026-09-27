// privacy/screenshotRedactor.js  —  runs in the SIDE PANEL document
//
// Takes the captured screenshot plus fused detections and paints OPAQUE blocks
// over every sensitive region using OffscreenCanvas. Returns a sanitized PNG.
//
// CoordinateUtils is still a classic script (it's also injected into pages
// alongside detector.js/contentScript.js) so we read it from window here.

var MASK_FILL = "#141414";
var MASK_LABEL = "#ffffff";
var EXPORT_MAX_WIDTH = 1400;

function dataUrlToBlob(dataUrl) {
  return fetch(dataUrl).then(function (r) {
    if (!r.ok) throw new Error("could not read screenshot data URL");
    return r.blob();
  });
}

function blobToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    var fr = new FileReader();
    fr.onload = function () { resolve(fr.result); };
    fr.onerror = function () { reject(new Error("failed to encode sanitized screenshot")); };
    fr.readAsDataURL(blob);
  });
}

async function redact(screenshotDataUrl, detections, viewport) {
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas is not available in this browser.");
  }
  if (typeof createImageBitmap === "undefined") {
    throw new Error("createImageBitmap is not available.");
  }

  var CU = window.CoordinateUtils;
  if (!CU) {
    throw new Error("CoordinateUtils is not loaded on window — check sidepanel.html script order.");
  }

  var blob = await dataUrlToBlob(screenshotDataUrl);
  var bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    throw new Error("could not decode screenshot into an ImageBitmap");
  }

  var imgW = bitmap.width;
  var imgH = bitmap.height;

  var canvas = new OffscreenCanvas(imgW, imgH);
  var ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable.");

  ctx.drawImage(bitmap, 0, 0, imgW, imgH);
  bitmap.close && bitmap.close();

  var scale = CU.computeViewportScale(imgW, imgH, viewport);

  ctx.textBaseline = "middle";
  ctx.font = "12px -apple-system, Arial, sans-serif";
  for (var i = 0; i < detections.length; i++) {
    var d = detections[i];
    if (!d || !d.rect) continue;
    var imgRect = CU.domRectToImageRect(d.rect, scale, 3);
    imgRect = CU.clampImageRect(imgRect, imgW, imgH);
    if (imgRect.w <= 0 || imgRect.h <= 0) continue;

    ctx.fillStyle = MASK_FILL;
    ctx.fillRect(imgRect.x, imgRect.y, imgRect.w, imgRect.h);

    if (imgRect.w > 46 && imgRect.h >= 12) {
      ctx.fillStyle = MASK_LABEL;
      ctx.fillText(
        String(d.category || "redacted").toUpperCase(),
        imgRect.x + 4,
        imgRect.y + imgRect.h / 2
      );
    }
  }

  var outCanvas = canvas;
  if (imgW > EXPORT_MAX_WIDTH) {
    var ratio = EXPORT_MAX_WIDTH / imgW;
    var ow = Math.round(imgW * ratio);
    var oh = Math.round(imgH * ratio);
    var small = new OffscreenCanvas(ow, oh);
    var sctx = small.getContext("2d");
    sctx.drawImage(canvas, 0, 0, ow, oh);
    outCanvas = small;
  }

  var outBlob = await outCanvas.convertToBlob({ type: "image/png" });
  return await blobToDataUrl(outBlob);
}

export const ScreenshotRedactor = { redact };
