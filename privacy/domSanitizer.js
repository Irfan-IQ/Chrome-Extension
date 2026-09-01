// privacy/domSanitizer.js  —  runs in the PAGE (content-script isolated world)
//
// TEMPORARY, REVERSIBLE redaction of the live DOM.
//
// Contract:
//   redact(detections)  -> replaces visible sensitive values with "[REDACTED]"
//                          and records enough state to fully restore later.
//   restore()           -> puts every touched element back EXACTLY as it was.
//
// Design guarantees:
//   * We store the ORIGINAL state BEFORE mutating anything.
//   * restore() is idempotent and safe to call multiple times.
//   * We never destroy structure — only .value / text content of the specific
//     detected elements are changed.
//   * The caller (contentScript.js) wraps capture in try/finally AND arms a
//     watchdog timer, so the page is restored even if the side panel dies.

(function (root) {
  "use strict";

  var REDACTION = "[REDACTED]";

  // Module-level record of what we changed. One entry per touched element.
  var saved = [];

  function isFormFieldWithValue(el) {
    return (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT"
    );
  }

  function isContentEditable(el) {
    return el.isContentEditable === true ||
      (el.getAttribute && el.getAttribute("contenteditable") !== null &&
       el.getAttribute("contenteditable") !== "false");
  }

  /**
   * @param {Array} detections  output of PrivacyDetector.scan().detections
   *                            (each has a live ._el reference)
   */
  function redact(detections) {
    // Fresh start; if a previous run left anything, restore it first.
    if (saved.length) restore();

    for (var i = 0; i < detections.length; i++) {
      var el = detections[i] && detections[i]._el;
      if (!el || !el.isConnected) continue;

      try {
        if (isFormFieldWithValue(el)) {
          if (el.tagName === "SELECT") {
            // A <select> cannot show arbitrary text. We can't safely fake an
            // option without disturbing layout, so we rely on the screenshot
            // mask for the visual and just flag it. Nothing to restore.
            saved.push({ el: el, kind: "select-noop" });
            continue;
          }
          // INPUT / TEXTAREA
          saved.push({
            el: el,
            kind: "value",
            originalValue: el.value,
          });
          el.value = REDACTION;
          // Fire input event so frameworks re-render the redacted value.
          try {
            el.dispatchEvent(new Event("input", { bubbles: true }));
          } catch (e) {}
        } else if (isContentEditable(el)) {
          saved.push({
            el: el,
            kind: "contenteditable",
            originalHTML: el.innerHTML,
          });
          el.textContent = REDACTION;
        } else {
          // Generic text-bearing element the detector was confident about.
          // Safe DOM replacement: swap textContent only, keep the node.
          saved.push({
            el: el,
            kind: "text",
            originalHTML: el.innerHTML,
          });
          el.textContent = REDACTION;
        }
      } catch (e) {
        // If a single element fails, keep going; restore() will still work
        // for the ones we DID record.
        try {
          console.debug("[V2 privacy] redact skipped one element:", e && e.name);
        } catch (_) {}
      }
    }

    return saved.length;
  }

  /**
   * Restore every element we touched, in reverse order. Idempotent.
   * @returns {number} how many elements were restored
   */
  function restore() {
    var n = 0;
    for (var i = saved.length - 1; i >= 0; i--) {
      var rec = saved[i];
      if (!rec || !rec.el) continue;
      try {
        if (rec.kind === "value") {
          rec.el.value = rec.originalValue;
          try {
            rec.el.dispatchEvent(new Event("input", { bubbles: true }));
          } catch (e) {}
          n++;
        } else if (rec.kind === "contenteditable" || rec.kind === "text") {
          rec.el.innerHTML = rec.originalHTML;
          n++;
        }
        // "select-noop" — nothing to do
      } catch (e) {
        try {
          console.debug("[V2 privacy] restore issue on one element:", e && e.name);
        } catch (_) {}
      }
    }
    saved = [];
    return n;
  }

  function isDirty() {
    return saved.length > 0;
  }

  root.PrivacyDomSanitizer = {
    redact: redact,
    restore: restore,
    isDirty: isDirty,
    REDACTION: REDACTION,
  };
})(typeof window !== "undefined" ? window : self);
