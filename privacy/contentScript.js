// privacy/contentScript.js  —  runs in the PAGE (content-script isolated world)
//
// Thin message bridge between the side panel and the page-context privacy
// modules (detector.js + domSanitizer.js). Injected on demand via
// chrome.scripting.executeScript.
//
// Two messages:
//   { type: "PRIVACY_REDACT" }  -> scan live DOM, save originals, redact,
//                                  arm a watchdog, return detections+viewport.
//   { type: "PRIVACY_RESTORE" } -> cancel watchdog, restore DOM.
//
// WATCHDOG: after redacting we start an 8s timer that auto-restores the page.
// This is the safety net for "the side panel crashed / was closed before it
// could send PRIVACY_RESTORE" — the user's page must never stay redacted.

(function () {
  "use strict";

  // Guard against re-injection: keep exactly one listener + one state object.
  if (window.__V2_PRIVACY_BRIDGE__) {
    return;
  }
  window.__V2_PRIVACY_BRIDGE__ = { installed: true };

  var WATCHDOG_MS = 8000;
  var watchdog = null;

  function armWatchdog() {
    clearWatchdog();
    watchdog = setTimeout(function () {
      try {
        if (window.PrivacyDomSanitizer && window.PrivacyDomSanitizer.isDirty()) {
          window.PrivacyDomSanitizer.restore();
          console.debug("[V2 privacy] watchdog restored the page");
        }
      } catch (e) {}
      watchdog = null;
    }, WATCHDOG_MS);
  }

  function clearWatchdog() {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  function handleRedact() {
    try {
      if (!window.PrivacyDetector || !window.PrivacyDomSanitizer) {
        return { ok: false, error: "privacy modules not loaded" };
      }

      // Scan RIGHT NOW — never a stale snapshot (dynamic pages).
      var scan = window.PrivacyDetector.scan();

      // Save originals + redact. domSanitizer stores state internally.
      window.PrivacyDomSanitizer.redact(scan.detections);

      // Arm the auto-restore safety net.
      armWatchdog();

      // Strip the live element handle (_el) before it leaves the page.
      var detections = scan.detections.map(function (d) {
        return {
          category: d.category,
          elementType: d.elementType,
          type: d.type,
          selector: d.selector,
          rect: d.rect,
          confidence: d.confidence,
        };
      });

      return {
        ok: true,
        detections: detections,
        uninspectable: scan.uninspectable,
        viewport: scan.viewport,
      };
    } catch (e) {
      // Best-effort restore if we half-redacted, then report failure so the
      // side panel FAILS CLOSED (does not send anything to Gemini).
      try {
        if (window.PrivacyDomSanitizer) window.PrivacyDomSanitizer.restore();
      } catch (_) {}
      clearWatchdog();
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  function handleRestore() {
    clearWatchdog();
    try {
      var n = window.PrivacyDomSanitizer
        ? window.PrivacyDomSanitizer.restore()
        : 0;
      return { ok: true, restored: n };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "PRIVACY_REDACT") {
      sendResponse(handleRedact());
      return; // synchronous response
    }
    if (msg.type === "PRIVACY_RESTORE") {
      sendResponse(handleRestore());
      return;
    }
    if (msg.type === "PRIVACY_PING") {
      sendResponse({ ok: true, ready: !!(window.PrivacyDetector && window.PrivacyDomSanitizer) });
      return;
    }
  });

  console.debug("[V2 privacy] content bridge installed");
})();
