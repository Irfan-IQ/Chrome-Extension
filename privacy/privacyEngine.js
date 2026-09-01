// privacy/privacyEngine.js  —  runs in the SIDE PANEL document
//
// The one public entry point the chatbot calls:
//
//   const result = await PrivacyEngine.sanitizeCurrentPage(onProgress)
//   // result = { ok, sanitizedScreenshot, sanitizedDOM, detectedElements,
//   //            uninspectable, host }
//
// Pipeline (each step FAILS CLOSED — any error throws PrivacyError and the
// caller must NOT send anything to Gemini):
//
//   1. find active tab, reject restricted URLs (chrome://, PDF, etc.)
//   2. inject page modules (coordinateUtils, detector, domSanitizer, bridge)
//   3. PRIVACY_REDACT  -> scan LIVE dom, save originals, redact in place
//   4. chrome.tabs.captureVisibleTab -> raw (sensitive) screenshot
//   5. ScreenshotRedactor.redact -> opaque masks via OffscreenCanvas
//   6. build sanitized structured DOM (NO values, ever)
//   7. finally: PRIVACY_RESTORE -> page back to original (watchdog backs this up)
//
// The raw screenshot and raw DOM never leave this function.

(function (root) {
  "use strict";

  // Distinct error type so the chatbot can show the mandated
  // "Privacy sanitization failed. The request was not sent." message.
  function PrivacyError(message) {
    this.name = "PrivacyError";
    this.message = message;
  }
  PrivacyError.prototype = Object.create(Error.prototype);
  PrivacyError.prototype.constructor = PrivacyError;

  var PAGE_MODULES = [
    "privacy/coordinateUtils.js",
    "privacy/detector.js",
    "privacy/domSanitizer.js",
    "privacy/contentScript.js",
  ];

  // URLs where content scripts / captureVisibleTab are not allowed or not useful.
  var RESTRICTED_SCHEME = /^(chrome|chrome-extension|edge|about|devtools|view-source|moz-extension):/i;
  var WEBSTORE = /^https:\/\/chromewebstore\.google\.com|^https:\/\/chrome\.google\.com\/webstore/i;

  function noop() {}

  async function getActiveTab() {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0];
  }

  function safeHost(url) {
    try {
      return new URL(url).host;
    } catch (e) {
      return null;
    }
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
        "This is a browser/internal page (" +
          url.split(":")[0] +
          ":). It cannot be scanned."
      );
    }
    if (/\.pdf($|\?|#)/i.test(url) || url.startsWith("blob:")) {
      throw new PrivacyError("PDF / blob viewer pages cannot be scanned in V2.");
    }
  }

  async function injectModules(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: false },
        files: PAGE_MODULES,
      });
    } catch (e) {
      // Common causes: no host access, restricted page, file:// without the
      // "Allow access to file URLs" toggle.
      throw new PrivacyError(
        "Could not inject the privacy engine into this page (" +
          ((e && e.message) || "unknown") +
          ")."
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

  // Build the SAFE structured representation sent to Gemini instead of raw HTML.
  function buildSanitizedDOM(detections, uninspectable, viewport) {
    return {
      scanned: true,
      scanType: "dom-only",
      note:
        "V2 DOM-only privacy scan. Field VALUES are redacted to '[REDACTED]'. " +
        "This layer does NOT analyse or detect sensitive content inside images.",
      viewport: { width: viewport.width, height: viewport.height },
      fields: detections.map(function (d) {
        return {
          tag: d.elementType,
          type: d.type || null,
          category: d.category,
          confidence: d.confidence,
          visible: true,
          value: "[REDACTED]",
          selector: d.selector,
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

  /**
   * @param {function(string):void} [onProgress] status callback
   * @returns {Promise<object>} sanitized bundle (see file header)
   */
  async function sanitizeCurrentPage(onProgress) {
    var progress = typeof onProgress === "function" ? onProgress : noop;

    if (!chrome.scripting || !chrome.tabs || !chrome.tabs.captureVisibleTab) {
      throw new PrivacyError(
        "Missing extension permissions (scripting / tabs). Reload the extension."
      );
    }

    progress("Locating active tab...");
    var tab = await getActiveTab();
    assertScannable(tab);

    progress("Injecting privacy engine...");
    await injectModules(tab.id);

    progress("Scanning page & detecting sensitive fields...");
    var redactRes = await sendToPage(tab.id, { type: "PRIVACY_REDACT" });
    if (!redactRes || !redactRes.ok) {
      throw new PrivacyError(
        "DOM scan/redaction failed (" +
          ((redactRes && redactRes.error) || "no response") +
          ")."
      );
    }

    var detections = redactRes.detections || [];
    var uninspectable = redactRes.uninspectable || [];
    var viewport = redactRes.viewport || { width: 0, height: 0 };

    var sanitizedScreenshot, sanitizedDOM;
    try {
      progress("Capturing visible tab...");
      var rawShot;
      try {
        rawShot = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png",
        });
      } catch (e) {
        throw new PrivacyError(
          "Screenshot capture failed (" + ((e && e.message) || "unknown") + ")."
        );
      }
      if (!rawShot || typeof rawShot !== "string") {
        throw new PrivacyError("Screenshot capture returned no image.");
      }

      progress("Sanitizing screenshot (OffscreenCanvas)...");
      try {
        sanitizedScreenshot = await root.ScreenshotRedactor.redact(
          rawShot,
          detections,
          viewport
        );
      } catch (e) {
        throw new PrivacyError(
          "Screenshot redaction failed (" + ((e && e.message) || "unknown") + ")."
        );
      }
      // Drop the raw screenshot reference immediately.
      rawShot = null;

      sanitizedDOM = buildSanitizedDOM(detections, uninspectable, viewport);
    } finally {
      // ALWAYS restore, even on error. Watchdog in the page is the backup.
      progress("Restoring original page...");
      await sendToPage(tab.id, { type: "PRIVACY_RESTORE" });
    }

    progress("Ready to send to Gemini.");
    return {
      ok: true,
      sanitizedScreenshot: sanitizedScreenshot,
      sanitizedDOM: sanitizedDOM,
      detectedElements: detections,
      uninspectable: uninspectable,
      host: safeHost(tab.url),
    };
  }

  root.PrivacyEngine = {
    sanitizeCurrentPage: sanitizeCurrentPage,
    PrivacyError: PrivacyError,
  };
})(typeof window !== "undefined" ? window : self);
