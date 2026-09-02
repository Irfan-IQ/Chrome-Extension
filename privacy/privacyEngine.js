// privacy/privacyEngine.js  —  runs in the SIDE PANEL document
//
// V3 — Hybrid DOM + OCR + Pattern + Context + Fusion privacy pipeline.
//
// Public entry point (unchanged from V2):
//   const result = await PrivacyEngine.sanitizeCurrentPage(onProgress)
//
// Result shape (V3 additions marked with *):
//   {
//     ok, sanitizedScreenshot, sanitizedDOM,
//     detectedElements,   ← fused detections (DOM + OCR)    *enriched*
//     uninspectable, host,
//     ocrEnabled,         ← bool: was OCR run?              *new*
//     ocrWordCount,       ← number of OCR words found       *new*
//     fusionSummary,      ← per-source detection counts      *new*
//   }
//
// V3 pipeline:
//   1. find active tab, reject restricted URLs
//   2. inject page modules (same as V2)
//   3. PRIVACY_REDACT  → DOM redact (values → [REDACTED]), get DOM detections
//   4. captureVisibleTab → raw screenshot
//      (DOM fields now show "[REDACTED]" so OCR cannot read their real values)
//   5. OCR the screenshot → words + lines (images/canvas still show original)
//   6. PatternAnalyzer.classifyWords() → structured PII from OCR text
//   7. ContextAnalyzer.analyze()       → label-gated / NER detections
//   8. DetectionFusion.fuse()          → merged DOM + OCR detections (CSS px)
//   9. ScreenshotRedactor.redact()     → opaque blocks over ALL fused regions
//  10. buildSanitizedDOM()             → structured context for Gemini
//  11. finally: PRIVACY_RESTORE        → page back to original
//
// Fail-closed: any error throws PrivacyError; caller must NOT send to Gemini.
// OCR failure is a SOFT failure — if OCR errors, fall back to V2 DOM-only
// rather than blocking the whole request.

(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // PrivacyError — distinct type so the chatbot shows the right message
  // ---------------------------------------------------------------------------
  function PrivacyError(message) {
    this.name = "PrivacyError";
    this.message = message;
  }
  PrivacyError.prototype = Object.create(Error.prototype);
  PrivacyError.prototype.constructor = PrivacyError;

  // ---------------------------------------------------------------------------
  // Modules injected into the PAGE (same as V2 — unchanged)
  // ---------------------------------------------------------------------------
  var PAGE_MODULES = [
    "privacy/coordinateUtils.js",
    "privacy/detector.js",
    "privacy/domSanitizer.js",
    "privacy/contentScript.js",
  ];

  // URLs where scripting / capture are not allowed
  var RESTRICTED_SCHEME = /^(chrome|chrome-extension|edge|about|devtools|view-source|moz-extension):/i;
  var WEBSTORE = /^https:\/\/chromewebstore\.google\.com|^https:\/\/chrome\.google\.com\/webstore/i;

  function noop() {}

  // ---------------------------------------------------------------------------
  // Tab helpers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Get screenshot dimensions from a data URL (used for scale computation)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Build the sanitized DOM structure sent to Gemini (V3 enriched)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Summarise fusion results for the UI (count by source set)
  // ---------------------------------------------------------------------------
  function buildFusionSummary(detections) {
    var summary = { total: detections.length, bySource: {}, byCategory: {} };
    detections.forEach(function (d) {
      var srcKey = (d.sources || ["dom"]).slice().sort().join("+");
      summary.bySource[srcKey] = (summary.bySource[srcKey] || 0) + 1;
      summary.byCategory[d.category] = (summary.byCategory[d.category] || 0) + 1;
    });
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Main pipeline
  // ---------------------------------------------------------------------------

  /**
   * @param {function(string):void} [onProgress]
   * @returns {Promise<object>}
   */
  /**
   * Standalone scan — runs the full V3 pipeline WITHOUT sending to Gemini.
   * Returns the same shape as sanitizeCurrentPage() plus `beforeScreenshot`.
   * Safe to call from the "Scan Page" button.
   *
   * @param {function(string):void} [onProgress]
   * @returns {Promise<object>}
   */
  async function scanPage(onProgress) {
    return sanitizeCurrentPage(onProgress);
  }

  async function sanitizeCurrentPage(onProgress) {
    var progress = typeof onProgress === "function" ? onProgress : noop;

    if (!chrome.scripting || !chrome.tabs || !chrome.tabs.captureVisibleTab) {
      throw new PrivacyError(
        "Missing extension permissions (scripting / tabs). Reload the extension."
      );
    }

    // ---- Step 1: Locate and validate active tab ----------------------------
    progress("Locating active tab…");
    var tab = await getActiveTab();
    assertScannable(tab);

    // ---- Step 2: Inject page modules (same as V2) --------------------------
    progress("Injecting privacy engine…");
    await injectModules(tab.id);

    // ---- Step 2b: Capture "before" screenshot (BEFORE DOM redact) ----------
    // This is shown only in the local UI for before/after comparison.
    // It is NEVER sent to any external service.
    var beforeScreenshot = null;
    try {
      beforeScreenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    } catch (e) {
      // Non-fatal — we just won't show the before screenshot
      console.warn("[V3] Before-screenshot capture failed:", e && e.message);
    }

    // ---- Step 3: DOM scan + redact -----------------------------------------
    progress("Scanning DOM & temporarily redacting sensitive fields…");
    var redactRes = await sendToPage(tab.id, { type: "PRIVACY_REDACT" });
    if (!redactRes || !redactRes.ok) {
      throw new PrivacyError(
        "DOM scan/redaction failed (" +
          ((redactRes && redactRes.error) || "no response") + ")."
      );
    }

    var domDetections = redactRes.detections || [];
    var uninspectable  = redactRes.uninspectable || [];
    var viewport       = redactRes.viewport || { width: 1280, height: 800 };

    var sanitizedScreenshot, sanitizedDOM, fusedDetections;
    var ocrEnabled  = false;
    var ocrWordCount = 0;

    try {
      // ---- Step 4: Capture visible tab -------------------------------------
      // At this point DOM fields show "[REDACTED]" — OCR will NOT see real values.
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

      // Get screenshot dimensions for coordinate mapping
      var shotSize = await getImageDimensions(rawShot);

      // ---- Step 5-7: OCR → Pattern → Context (soft failure) ---------------
      var ocrDetections = [];
      var ocrError = null;

      try {
        if (root.OcrAnalyzer) {
          var ocrResult = await root.OcrAnalyzer.analyzeScreenshot(rawShot, progress);
          ocrWordCount = ocrResult.words.length;

          // --- Step 6: Pattern classification of OCR words ---
          progress("Classifying OCR text…");
          var patternDetections = [];
          if (root.PatternAnalyzer && ocrResult.words.length > 0) {
            patternDetections = root.PatternAnalyzer.classifyWords(ocrResult.words);
          }

          // --- Step 7: Context / NER analysis ---
          var contextDetections = [];
          if (root.ContextAnalyzer && ocrResult.words.length > 0) {
            contextDetections = root.ContextAnalyzer.analyze(
              ocrResult.words,
              ocrResult.lines
            );
          }

          // Combine OCR-derived detections
          ocrDetections = patternDetections.concat(contextDetections);
          ocrEnabled = true;
          console.debug(
            "[V3] OCR words:", ocrWordCount,
            "pattern detections:", patternDetections.length,
            "context detections:", contextDetections.length
          );
        }
      } catch (ocrErr) {
        // OCR is a soft failure — fall back to DOM-only (V2 behavior)
        ocrError = ocrErr;
        console.warn(
          "[V3] OCR layer failed (falling back to V2 DOM-only):",
          (ocrErr && ocrErr.message) || ocrErr
        );
        ocrEnabled = false;
      }

      // ---- Step 8: Fusion --------------------------------------------------
      progress("Fusing DOM + OCR detections…");
      if (root.DetectionFusion && ocrDetections.length > 0) {
        fusedDetections = root.DetectionFusion.fuse(
          domDetections,
          ocrDetections,
          viewport,
          shotSize
        );
      } else {
        // No OCR or fusion module — use DOM detections directly (V2 fallback)
        // Map to the same shape as fused detections
        fusedDetections = domDetections.map(function (d) {
          return Object.assign({}, d, {
            sources: ["dom"],
            confidenceLabel: d.confidence,
          });
        });
      }

      // ---- Step 9: Screenshot redaction with fused detections --------------
      progress("Masking sensitive regions in screenshot…");
      try {
        sanitizedScreenshot = await root.ScreenshotRedactor.redact(
          rawShot,
          fusedDetections,
          viewport
        );
      } catch (e) {
        throw new PrivacyError(
          "Screenshot redaction failed (" + ((e && e.message) || "unknown") + ")."
        );
      }

      // Drop the raw screenshot reference immediately
      rawShot = null;

      // ---- Step 10: Build sanitized DOM for Gemini -------------------------
      sanitizedDOM = buildSanitizedDOM(fusedDetections, uninspectable, viewport, ocrEnabled);

    } finally {
      // ALWAYS restore, even on error. Watchdog in the page is the backup.
      progress("Restoring original page…");
      await sendToPage(tab.id, { type: "PRIVACY_RESTORE" });
    }

    progress("Ready.");
    return {
      ok: true,
      sanitizedScreenshot: sanitizedScreenshot,
      beforeScreenshot: beforeScreenshot,   // local-only, for UI comparison
      sanitizedDOM: sanitizedDOM,
      detectedElements: fusedDetections,
      uninspectable: uninspectable,
      host: safeHost(tab.url),
      ocrEnabled: ocrEnabled,
      ocrWordCount: ocrWordCount,
      fusionSummary: buildFusionSummary(fusedDetections || []),
    };
  }

  root.PrivacyEngine = {
    sanitizeCurrentPage: sanitizeCurrentPage,
    scanPage: scanPage,
    PrivacyError: PrivacyError,
  };
})(typeof window !== "undefined" ? window : self);
