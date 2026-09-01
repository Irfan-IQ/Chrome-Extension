// privacy/screenshotRedactor.js  —  runs in the SIDE PANEL document
//
// Takes the captured screenshot (a data: URL from chrome.tabs.captureVisibleTab)
// plus the DOM detections, and paints OPAQUE blocks over every sensitive region
// using OffscreenCanvas. Returns a sanitized PNG data URL.
//
// V2 masking policy:
//   * OPAQUE fill only. NO blur. Blur can sometimes be reversed; a solid block
//     cannot. The block must completely cover the original pixels.
//   * The screenshot passed IN here is the raw (still-sensitive) capture. It
//     NEVER leaves this function. Only the sanitized output is returned.

(function (root) {
  "use strict";

  var CU = root.CoordinateUtils;

  var MASK_FILL = "#141414"; // neutral dark, fully opaque
  var MASK_LABEL = "#ffffff";
  var EXPORT_MAX_WIDTH = 1400; // downscale huge screenshots to keep payload small

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then(function (r) {
      if (!r.ok) throw new Error("could not read screenshot data URL");
      return r.blob();
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(fr.result);
      };
      fr.onerror = function () {
        reject(new Error("failed to encode sanitized screenshot"));
      };
      fr.readAsDataURL(blob);
    });
  }

  /**
   * @param {string} screenshotDataUrl  raw capture (data:image/png;base64,...)
   * @param {Array}  detections         [{ rect:{x,y,width,height}, category }]
   * @param {{width:number,height:number}} viewport  CSS-pixel viewport size
   * @returns {Promise<string>} sanitized PNG data URL
   */
  async function redact(screenshotDataUrl, detections, viewport) {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is not available in this browser.");
    }
    if (typeof createImageBitmap === "undefined") {
      throw new Error("createImageBitmap is not available.");
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

    // 1. draw the screenshot
    ctx.drawImage(bitmap, 0, 0, imgW, imgH);
    bitmap.close && bitmap.close();

    // 2. work out CSS-px -> image-px scale from REAL measured sizes
    //    (absorbs devicePixelRatio + browser zoom + OS scaling in one ratio)
    var scale = CU.computeViewportScale(imgW, imgH, viewport);

    // 3. paint opaque blocks
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

      // small label so the model knows WHAT was masked (category only)
      if (imgRect.w > 46 && imgRect.h >= 12) {
        ctx.fillStyle = MASK_LABEL;
        ctx.fillText(
          String(d.category || "redacted").toUpperCase(),
          imgRect.x + 4,
          imgRect.y + imgRect.h / 2
        );
      }
    }

    // 4. optional downscale for a smaller payload
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

  root.ScreenshotRedactor = { redact: redact };
})(typeof window !== "undefined" ? window : self);
