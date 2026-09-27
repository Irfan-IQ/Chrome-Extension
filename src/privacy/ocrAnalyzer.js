// privacy/ocrAnalyzer.js  —  runs in the SIDE PANEL
//
// OCR abstraction layer wrapping Tesseract.js v4.
// Tesseract.js itself is still loaded as a classic script in sidepanel.html,
// so `Tesseract` here refers to the global set by lib/tesseract.min.js.
//
// PRIVACY RULES:
//   * OCR runs entirely locally (Tesseract.js, no external API).
//   * Screenshots are never sent outside the browser.
//   * The module logs word count and confidence stats, NEVER the text itself.

var CONFIG = {
  MIN_WORD_CONFIDENCE: 30,
  MAX_OCR_WIDTH: 1920,
  getWorkerPath: function () {
    return (typeof chrome !== "undefined" && chrome.runtime)
      ? chrome.runtime.getURL("lib/tesseract.worker.min.js")
      : "lib/tesseract.worker.min.js";
  },
  getLangPath: function () {
    return (typeof chrome !== "undefined" && chrome.runtime)
      ? chrome.runtime.getURL("lib/")
      : "lib/";
  },
  getCorePath: function () {
    return (typeof chrome !== "undefined" && chrome.runtime)
      ? chrome.runtime.getURL("lib/tesseract-core-simd.wasm")
      : "lib/tesseract-core-simd.wasm";
  },
};

var _worker = null;
var _workerReady = false;
var _initPromise = null;

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
      langPath: CONFIG.getLangPath(),
      corePath: CONFIG.getCorePath(),
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

function maybeDownscale(dataUrl) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      if (w <= CONFIG.MAX_OCR_WIDTH) {
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

function extractResults(data, originalW, scaledW) {
  var scaleBack = (scaledW && scaledW < originalW) ? originalW / scaledW : 1;

  var words = [];
  var lines = [];

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
        confidence: conf / 100,
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

  if (Array.isArray(data.lines)) {
    for (var j = 0; j < data.lines.length; j++) {
      var l = data.lines[j];
      if (!l || !l.text) continue;
      var lText = l.text.trim();
      if (!lText) continue;
      var lbbox = l.bbox || {};

      var lineY0 = (lbbox.y0 || 0);
      var lineY1 = (lbbox.y1 || 0);
      var lineWords = words.filter(function (word) {
        var wy = (word.boundingBox.y / scaleBack);
        return wy >= lineY0 - 5 && wy <= lineY1 + 5;
      });

      lines.push({
        text: lText,
        boundingBox: {
          x: Math.round((lbbox.x0 || 0) * scaleBack),
          y: Math.round((lbbox.y0 || 0) * scaleBack),
          width: Math.round(((lbbox.x1 || 0) - (lbbox.x0 || 0)) * scaleBack),
          height: Math.round(((lbbox.y1 || 0) - (lbbox.y0 || 0)) * scaleBack),
        },
        _words: lineWords,
      });
    }
  }

  return { words: words, lines: lines };
}

async function analyzeScreenshot(dataUrl, onProgress) {
  var progress = typeof onProgress === "function" ? onProgress : function () {};

  var worker = await ensureWorker(progress);

  progress("Pre-processing screenshot for OCR…");
  var prepared = await maybeDownscale(dataUrl);

  progress("Running OCR on page content…");
  var recognizeResult = await worker.recognize(prepared.dataUrl);
  var data = recognizeResult.data;

  var extracted = extractResults(data, prepared.imgW, prepared.scaledW);

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

export const OcrAnalyzer = {
  analyzeScreenshot,
  isReady,
  terminate,
};
