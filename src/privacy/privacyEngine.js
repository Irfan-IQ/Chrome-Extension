// privacy/privacyEngine.js  —  runs in the SIDE PANEL document
//
// V4 hybrid DOM + OCR + Pattern + Context + Fusion privacy pipeline.
// See docs/ARCHITECTURE.md.
//
// Public entry point:
//   const result = await PrivacyEngine.sanitizeCurrentPage(onProgress)
//
// Fail-closed: any error throws PrivacyError; caller must NOT send to Gemini.
// OCR failure is a SOFT failure — falls back to DOM-only rather than blocking.

import { OcrAnalyzer }        from './ocrAnalyzer.js';
import { PatternAnalyzer }    from './patternAnalyzer.js';
import { ContextAnalyzer }    from './contextAnalyzer.js';
import { DetectionFusion }    from './detectionFusion.js';
import { ScreenshotRedactor } from './screenshotRedactor.js';
import { VisionEngine }       from '../vision/visionEngine.js';
import { debug }              from '../debug.js';

class PrivacyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrivacyError';
  }
}

// Modules injected into the PAGE via chrome.scripting.executeScript.
// These MUST remain classic scripts (executeScript files: mode).
var PAGE_MODULES = [
  "privacy/coordinateUtils.js",
  "privacy/detector.js",
  "privacy/contentScript.js",
];

var RESTRICTED_SCHEME = /^(chrome|chrome-extension|edge|about|devtools|view-source|moz-extension):/i;
var WEBSTORE = /^https:\/\/chromewebstore\.google\.com|^https:\/\/chrome\.google\.com\/webstore/i;

function noop() {}

async function getActiveTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

function safeHost(url) {
  try { return new URL(url).host; } catch (e) { return null; }
}

function assertScannable(tab) {
  if (!tab || !tab.id || tab.id < 0) {
    throw new PrivacyError("No active tab to scan.");
  }
  var url = tab.url || tab.pendingUrl || "";
  if (!url) {
    throw new PrivacyError(
      "Cannot read the current tab's URL (missing permission or restricted page)."
    );
  }
  if (RESTRICTED_SCHEME.test(url) || WEBSTORE.test(url)) {
    throw new PrivacyError(
      "This is a browser/internal page (" + url.split(":")[0] +
      ":). It cannot be scanned. Turn off Privacy Protection to chat without page context."
    );
  }
  if (/\.pdf($|\?|#)/i.test(url) || url.startsWith("blob:")) {
    throw new PrivacyError("PDF / blob viewer pages cannot be scanned.");
  }
}

async function injectModules(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: false },
      files: PAGE_MODULES,
    });
  } catch (e) {
    throw new PrivacyError(
      "Could not inject the privacy engine into this page (" +
        ((e && e.message) || "unknown") + ")."
    );
  }
}

async function sendToPage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    return { ok: false, error: "content script did not respond" };
  }
}

function getImageDimensions(dataUrl) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = function () {
      reject(new Error("Could not read screenshot dimensions"));
    };
    img.src = dataUrl;
  });
}

function buildSanitizedDOM(detections, uninspectable, viewport, ocrEnabled) {
  return {
    scanned: true,
    scanType: ocrEnabled ? "dom+ocr+pattern+context+fusion" : "dom-only",
    note:
      "V3 privacy scan. Field VALUES are '[REDACTED]'. " +
      (ocrEnabled
        ? "OCR was run on images/canvas; detected regions are also masked."
        : "OCR was not run (fallback to V2 DOM-only mode).") +
      " This scanner does NOT analyse image contents for non-text sensitive data.",
    viewport: { width: viewport.width, height: viewport.height },
    fields: detections.map(function (d) {
      return {
        tag: d.elementType || "ocr-region",
        type: d.type || null,
        category: d.category,
        confidence: typeof d.confidence === "number"
          ? Math.round(d.confidence * 100) / 100
          : d.confidence,
        confidenceLabel: d.confidenceLabel || d.confidence,
        sources: d.sources || ["dom"],
        visible: true,
        value: "[REDACTED]",
        selector: d.selector || null,
        rect: d.rect,
      };
    }),
    uninspectable: (uninspectable || []).map(function (u) {
      return {
        kind: u.kind || "iframe",
        reason: u.reason || "cross-origin",
        host: u.src || null,
        rect: u.rect || null,
        note: "uninspectable content — NOT privacy-scanned",
      };
    }),
  };
}

function buildFusionSummary(detections) {
  var summary = { total: detections.length, bySource: {}, byCategory: {} };
  detections.forEach(function (d) {
    var srcKey = (d.sources || ["dom"]).slice().sort().join("+");
    summary.bySource[srcKey] = (summary.bySource[srcKey] || 0) + 1;
    summary.byCategory[d.category] = (summary.byCategory[d.category] || 0) + 1;
  });
  return summary;
}

async function scanPage(onProgress) {
  // Scan Page always runs a fresh pipeline — it's the user's explicit
  // "show me what you see" button, so a cached snapshot would be surprising.
  return sanitizeCurrentPage(onProgress, { force: true });
}

// -----------------------------------------------------------------------
// Result cache
// -----------------------------------------------------------------------
// Repeated chat messages in the same tab trigger sanitizeCurrentPage once
// per send. The full pipeline (screenshot → DOM scan → OCR → vision →
// fusion → redaction) takes several seconds, so if the user sends two or
// three messages back-to-back without navigating we re-use the previous
// result instead of re-running everything.
//
// Keyed by (tabId, url). TTL is intentionally short so page edits (typing
// into a form, scrolling, async-loaded content) can't go unnoticed for
// long. The cache is invalidated eagerly on any tab navigation.

var CACHE_TTL_MS = 10_000;
var resultCache = new Map();

function cacheKey(tab) {
  return tab.id + "|" + (tab.url || "");
}

function readCache(tab) {
  var entry = resultCache.get(cacheKey(tab));
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    resultCache.delete(cacheKey(tab));
    return null;
  }
  return entry.result;
}

function writeCache(tab, result) {
  resultCache.set(cacheKey(tab), { ts: Date.now(), result: result });
}

function invalidateCache(tabId) {
  if (tabId == null) { resultCache.clear(); return; }
  for (var key of Array.from(resultCache.keys())) {
    if (key.indexOf(tabId + "|") === 0) resultCache.delete(key);
  }
}

// Hook tab navigation so a reload or URL change busts stale entries
// immediately rather than waiting out the TTL.
if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener(function (tabId, info) {
    if (info.status === "loading" || info.url) invalidateCache(tabId);
  });
  if (chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener(function (tabId) { invalidateCache(tabId); });
  }
}

async function sanitizeCurrentPage(onProgress, opts) {
  var progress = typeof onProgress === "function" ? onProgress : noop;
  var options  = opts || {};

  if (!chrome.scripting || !chrome.tabs || !chrome.tabs.captureVisibleTab) {
    throw new PrivacyError(
      "Missing extension permissions (scripting / tabs). Reload the extension."
    );
  }

  progress("Locating active tab…");
  var tab = await getActiveTab();
  assertScannable(tab);

  if (!options.force) {
    var cached = readCache(tab);
    if (cached) {
      progress("Reusing recent scan (same tab, no change).");
      return cached;
    }
  }

  progress("Injecting privacy engine…");
  await injectModules(tab.id);

  var beforeScreenshot = null;
  try {
    beforeScreenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch (e) {
    console.warn("[V4] Before-screenshot capture failed:", e && e.message);
  }

  progress("Scanning DOM for sensitive fields…");
  var redactRes = await sendToPage(tab.id, { type: "PRIVACY_SCAN" });
  if (!redactRes || !redactRes.ok) {
    throw new PrivacyError(
      "DOM scan failed (" +
        ((redactRes && redactRes.error) || "no response") + ")."
    );
  }

  var domDetections = redactRes.detections || [];
  var uninspectable  = redactRes.uninspectable || [];
  var viewport       = redactRes.viewport || { width: 1280, height: 800 };

  var sanitizedScreenshot, sanitizedDOM, fusedDetections;
  var ocrEnabled  = false;
  var ocrWordCount = 0;
  var visionEnabled = false;
  var visionDetections = [];
  var visionSummary = null;
  var visionStatus = VisionEngine.getStatus();

  try {
    progress("Capturing visible tab…");
    var rawShot;
    try {
      rawShot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    } catch (e) {
      throw new PrivacyError(
        "Screenshot capture failed (" + ((e && e.message) || "unknown") + ")."
      );
    }
    if (!rawShot || typeof rawShot !== "string") {
      throw new PrivacyError("Screenshot capture returned no image.");
    }

    var shotSize = await getImageDimensions(rawShot);

    try {
      progress("Loading local vision model and running vision detectors…");
      var visionResult = await VisionEngine.detectScreenshot(rawShot);
      visionDetections = visionResult.detections || [];
      visionSummary = visionResult.visionSummary || null;
      visionStatus = VisionEngine.getStatus();
      visionEnabled = true;
    } catch (visionErr) {
      console.warn(
        "[V4] Vision layer failed (continuing with DOM + OCR):",
        (visionErr && visionErr.message) || visionErr
      );
      visionEnabled = false;
      visionDetections = [];
      visionStatus = VisionEngine.getStatus();
    }

    var ocrDetections = [];

    try {
      var ocrResult = await OcrAnalyzer.analyzeScreenshot(rawShot, progress);
      ocrWordCount = ocrResult.words.length;

      progress("Classifying OCR text…");
      var patternDetections = [];
      if (ocrResult.words.length > 0) {
        patternDetections = PatternAnalyzer.classifyWords(ocrResult.words);
      }

      var contextDetections = [];
      if (ocrResult.words.length > 0) {
        contextDetections = ContextAnalyzer.analyze(
          ocrResult.words,
          ocrResult.lines
        );
      }

      ocrDetections = patternDetections.concat(contextDetections);
      ocrEnabled = true;
      debug(
        "[V3] OCR words:", ocrWordCount,
        "pattern detections:", patternDetections.length,
        "context detections:", contextDetections.length
      );
    } catch (ocrErr) {
      console.warn(
        "[V3] OCR layer failed (falling back to V2 DOM-only):",
        (ocrErr && ocrErr.message) || ocrErr
      );
      ocrEnabled = false;
    }

    progress("Fusing DOM + OCR detections…");
    if (ocrDetections.length > 0) {
      fusedDetections = DetectionFusion.fuse(
        domDetections,
        ocrDetections.concat(visionDetections),
        viewport,
        shotSize
      );
    } else {
      fusedDetections = domDetections.map(function (d) {
        return Object.assign({}, d, {
          sources: ["dom"],
          confidenceLabel: d.confidence,
        });
      });

      if (visionDetections.length > 0) {
        fusedDetections = DetectionFusion.fuse(
          [],
          visionDetections,
          viewport,
          shotSize
        ).concat(fusedDetections);
      }
    }

    progress("Masking sensitive regions in screenshot…");
    try {
      sanitizedScreenshot = await ScreenshotRedactor.redact(
        rawShot,
        fusedDetections,
        viewport
      );
    } catch (e) {
      throw new PrivacyError(
        "Screenshot redaction failed (" + ((e && e.message) || "unknown") + ")."
      );
    }

    rawShot = null;

    sanitizedDOM = buildSanitizedDOM(fusedDetections, uninspectable, viewport, ocrEnabled);

  } catch (e) {
    if (e && e.name === "PrivacyError") throw e;
    throw new PrivacyError("Unexpected error during privacy scan: " + ((e && e.message) || String(e)));
  }

  progress("Ready.");
  var result = {
    ok: true,
    sanitizedScreenshot: sanitizedScreenshot,
    beforeScreenshot: beforeScreenshot,
    sanitizedDOM: sanitizedDOM,
    detectedElements: fusedDetections,
    uninspectable: uninspectable,
    host: safeHost(tab.url),
    ocrEnabled: ocrEnabled,
    ocrWordCount: ocrWordCount,
    visionEnabled: visionEnabled,
    visionSummary: visionSummary,
    visionStatus: visionStatus,
    fusionSummary: buildFusionSummary(fusedDetections || []),
  };
  writeCache(tab, result);
  return result;
}

export const PrivacyEngine = {
  sanitizeCurrentPage,
  scanPage,
  invalidateCache,
  PrivacyError,
};
