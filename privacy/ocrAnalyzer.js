// privacy/ocrAnalyzer.js  —  runs in the SIDE PANEL
//
// OCR abstraction layer wrapping Tesseract.js v4.
//
// This module provides TEXT + BOUNDING BOXES from visual content.
// It does NOT classify whether that text is sensitive — that is the
// job of PatternAnalyzer and ContextAnalyzer.
//
// PRIVACY RULES:
//   * OCR runs entirely locally (Tesseract.js, no external API).
//   * Screenshots are never sent outside the browser.
//   * The module logs word count and confidence stats, NEVER the text itself.
//
// Public API:
//   OcrAnalyzer.analyzeScreenshot(dataUrl, onProgress?)
//     → Promise<{ words, lines, imgW, imgH }>
//
//   OcrAnalyzer.isReady()   → bool (worker initialised and ready)
//   OcrAnalyzer.terminate() → terminates the worker (call on extension unload)
//
// Word format:
//   { text, confidence, boundingBox: {x,y,width,height}, source:"ocr" }
//   confidence is 0–1 (normalised from Tesseract's 0–100).
//   boundingBox is in IMAGE PIXEL coordinates (same as the screenshot).
//
// Line format:
//   { text, boundingBox: {x,y,width,height} }

(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  var CONFIG = {
    // Tesseract minimum word confidence to include (0-100 scale)
    MIN_WORD_CONFIDENCE: 30,
    // Max image width fed to Tesseract (downscale for performance)
    MAX_OCR_WIDTH: 1920,
    // Worker / core paths resolved at runtime using chrome.runtime.getURL
    // so the files are served from the extension origin.
    getWorkerPath: function () {
      return (typeof chrome !== "undefined" && chrome.runtime)
        ? chrome.runtime.getURL("lib/tesseract.worker.min.js")
        : "lib/tesseract.worker.min.js";
    },
    // Language data fetched at runtime from CDN (data, not a script — allowed).
    langPath: "https://cdn.jsdelivr.net/npm/tesseract.js-data@4.0.0/",
    // WASM core: also from CDN (fetched via fetch(), not importScripts).
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.0/tesseract-core-simd.wasm",
  };

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------
  var _worker = null;
  var _workerReady = false;
  var _initPromise = null;

  // ---------------------------------------------------------------------------
  // Worker lifecycle
  // ---------------------------------------------------------------------------

  function ensureWorker(onProgress) {
    if (_workerReady && _worker) return Promise.resolve(_worker);
    if (_initPromise) return _initPromise;

    _initPromise = (function () {
      if (typeof Tesseract === "undefined") {
        return Promise.reject(
          new Error(
            "Tesseract.js is not loaded. Make sure lib/tesseract.min.js is included in sidepanel.html."
          )
        );
      }

      if (onProgress) onProgress("Initialising OCR engine (first run may take ~10 s)…");
      console.debug("[V3 OCR] Creating Tesseract worker…");

      return Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
        workerPath: CONFIG.getWorkerPath(),
        langPath: CONFIG.langPath,
        corePath: CONFIG.corePath,
        // Silent logger to avoid console spam
        logger: function (m) {
          if (m.progress && m.progress < 1) {
            if (onProgress && m.status) {
              onProgress("OCR: " + m.status + " (" + Math.round(m.progress * 100) + "%)");
            }
          }
        },
      }).then(function (w) {
        _worker = w;
        _workerReady = true;
        _initPromise = null;
        console.debug("[V3 OCR] Worker ready.");
        return w;
      });
    })();

    return _initPromise;
  }

  // ---------------------------------------------------------------------------
  // Image pre-processing — downscale before OCR if too large
  // ---------------------------------------------------------------------------

  function maybeDownscale(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        if (w <= CONFIG.MAX_OCR_WIDTH) {
          // No downscale needed — return original and dimensions
          resolve({ dataUrl: dataUrl, imgW: w, imgH: h });
          return;
        }
        var scale = CONFIG.MAX_OCR_WIDTH / w;
        var ow = Math.round(w * scale);
        var oh = Math.round(h * scale);

        var canvas;
        try {
          canvas = new OffscreenCanvas(ow, oh);
        } catch (e) {
          // OffscreenCanvas not available — try regular canvas
          canvas = document.createElement("canvas");
          canvas.width = ow;
          canvas.height = oh;
        }
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, ow, oh);

        var toBlob = canvas.convertToBlob
          ? canvas.convertToBlob({ type: "image/png" })
          : new Promise(function (res) { canvas.toBlob(res, "image/png"); });

        toBlob.then(function (blob) {
          var fr = new FileReader();
          fr.onload = function () { resolve({ dataUrl: fr.result, imgW: w, imgH: h, scaledW: ow, scaledH: oh }); };
          fr.onerror = function () { reject(new Error("FileReader failed")); };
          fr.readAsDataURL(blob);
        }).catch(reject);
      };
      img.onerror = function () { reject(new Error("Could not load screenshot for OCR")); };
      img.src = dataUrl;
    });
  }

  // ---------------------------------------------------------------------------
  // Extract words and lines from Tesseract result
  // ---------------------------------------------------------------------------

  function extractResults(data, originalW, scaledW) {
    // If image was downscaled, scale bounding boxes back to original px
    var scaleBack = (scaledW && scaledW < originalW)
      ? originalW / scaledW
      : 1;

    var words = [];
    var lines = [];

    // Words
    if (Array.isArray(data.words)) {
      for (var i = 0; i < data.words.length; i++) {
        var w = data.words[i];
        if (!w || !w.text) continue;
        var text = w.text.trim();
        if (!text) continue;
        var conf = typeof w.confidence === "number" ? w.confidence : 0;
        if (conf < CONFIG.MIN_WORD_CONFIDENCE) continue;

        var bbox = w.bbox || {};
        words.push({
          text: text,
          confidence: conf / 100,        // normalise to 0-1
          boundingBox: {
            x: Math.round((bbox.x0 || 0) * scaleBack),
            y: Math.round((bbox.y0 || 0) * scaleBack),
            width: Math.round(((bbox.x1 || 0) - (bbox.x0 || 0)) * scaleBack),
            height: Math.round(((bbox.y1 || 0) - (bbox.y0 || 0)) * scaleBack),
          },
          source: "ocr",
        });
      }
    }

    // Lines (for context analysis)
    if (Array.isArray(data.lines)) {
      for (var j = 0; j < data.lines.length; j++) {
        var l = data.lines[j];
        if (!l || !l.text) continue;
        var lText = l.text.trim();
        if (!lText) continue;
        var lbbox = l.bbox || {};
        lines.push({
          text: lText,
          boundingBox: {
            x: Math.round((lbbox.x0 || 0) * scaleBack),
            y: Math.round((lbbox.y0 || 0) * scaleBack),
            width: Math.round(((lbbox.x1 || 0) - (lbbox.x0 || 0)) * scaleBack),
            height: Math.round(((lbbox.y1 || 0) - (lbbox.y0 || 0)) * scaleBack),
          },
        });
      }
    }

    return { words: words, lines: lines };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Analyse a screenshot data-URL with Tesseract OCR.
   *
   * @param {string} dataUrl  — data:image/png;base64,…
   * @param {function} [onProgress]  — called with status strings
   * @returns {Promise<{words, lines, imgW, imgH}>}
   *   words:  [{ text, confidence, boundingBox, source:"ocr" }]
   *   lines:  [{ text, boundingBox }]
   *   imgW/H: original screenshot dimensions in px
   */
  async function analyzeScreenshot(dataUrl, onProgress) {
    var progress = typeof onProgress === "function" ? onProgress : function () {};

    // Ensure worker (lazy init)
    var worker = await ensureWorker(progress);

    // Optionally downscale for speed
    progress("Pre-processing screenshot for OCR…");
    var prepared = await maybeDownscale(dataUrl);

    progress("Running OCR on page content…");
    var recognizeResult = await worker.recognize(prepared.dataUrl);
    var data = recognizeResult.data;

    var extracted = extractResults(
      data,
      prepared.imgW,
      prepared.scaledW
    );

    console.debug(
      "[V3 OCR] words:", extracted.words.length,
      "lines:", extracted.lines.length,
      "(image:", prepared.imgW + "×" + prepared.imgH + "px)"
    );

    return {
      words: extracted.words,
      lines: extracted.lines,
      imgW: prepared.imgW,
      imgH: prepared.imgH,
    };
  }

  function isReady() { return _workerReady; }

  function terminate() {
    if (_worker) {
      try { _worker.terminate(); } catch (e) {}
      _worker = null;
      _workerReady = false;
    }
  }

  root.OcrAnalyzer = {
    analyzeScreenshot: analyzeScreenshot,
    isReady: isReady,
    terminate: terminate,
  };
})(typeof window !== "undefined" ? window : self);
