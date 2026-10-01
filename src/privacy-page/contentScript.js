// privacy/contentScript.js  —  runs in the PAGE (content-script isolated world)
//
// Thin message bridge between the side panel and the page-context privacy
// modules (detector.js). Injected on demand via chrome.scripting.executeScript.
//
// Message handled:
//   { type: "PRIVACY_SCAN" }  -> scan live DOM, return detections + viewport.
//                                Does NOT mutate the page.
//   { type: "PRIVACY_PING" }  -> health-check, returns ready flag.
//
// V4 design note: DOM mutation (the old "PRIVACY_REDACT / PRIVACY_RESTORE"
// pattern) has been removed. Redaction is done entirely in the side panel using
// OffscreenCanvas — opaque blocks are painted over the raw screenshot before it
// is sent anywhere. The raw screenshot never leaves the local pipeline, so there
// is no reason to mutate the page:
//   1. OffscreenCanvas is what actually sanitises the screenshot sent to Gemini.
//   2. OCR (Tesseract.js) runs entirely locally; it never forwards text values.
//   3. DOM mutation risked breaking React/Vue/Angular controlled-input state.
//   4. The 8-second watchdog timer + restore logic is no longer needed.

(function () {
  "use strict";

  // Guard against re-injection: keep exactly one listener.
  if (window.__PRIVACY_BRIDGE__) {
    return;
  }
  window.__PRIVACY_BRIDGE__ = { installed: true };

  function handleScan() {
    try {
      if (!window.PrivacyDetector) {
        return { ok: false, error: "PrivacyDetector not loaded" };
      }

      // Scan the live DOM right now — never use a stale snapshot.
      var scan = window.PrivacyDetector.scan();

      // Strip the live element handle (_el) before the result leaves the page;
      // it is a direct DOM reference that cannot be serialised via postMessage.
      var detections = scan.detections.map(function (d) {
        return {
          category:    d.category,
          elementType: d.elementType,
          type:        d.type,
          selector:    d.selector,
          rect:        d.rect,
          confidence:  d.confidence,
        };
      });

      return {
        ok:            true,
        detections:    detections,
        uninspectable: scan.uninspectable,
        viewport:      scan.viewport,
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== "string") return;

    // New canonical message name.
    if (msg.type === "PRIVACY_SCAN") {
      sendResponse(handleScan());
      return;
    }

    // Back-compat: old side-panel code may still send PRIVACY_REDACT.
    // Treat it as a plain scan — no DOM mutation.
    if (msg.type === "PRIVACY_REDACT") {
      sendResponse(handleScan());
      return;
    }

    // PRIVACY_RESTORE is now a no-op (nothing to undo).
    if (msg.type === "PRIVACY_RESTORE") {
      sendResponse({ ok: true, restored: 0 });
      return;
    }

    if (msg.type === "PRIVACY_PING") {
      sendResponse({ ok: true, ready: !!window.PrivacyDetector });
      return;
    }
  });

  console.debug("[V4 privacy] content bridge installed (scan-only, no DOM mutation)");
})();
