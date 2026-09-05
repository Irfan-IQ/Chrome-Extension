// agent/tools/redact.js — Tool wrapper for screenshot redaction
//
// Reuses: ScreenshotRedactor (screenshotRedactor.js — OffscreenCanvas, fully local)
//
// The LLM passes detection IDs (e.g. ["det_0", "det_2"]).
// This tool resolves those IDs to detection objects via AgentState,
// then calls ScreenshotRedactor.redact() to paint opaque blocks.
//
// PRIVACY:
//   • The raw screenshot never leaves this function.
//   • Only the masked result is stored (state.redactedScreenshot).
//   • The LLM receives only counts and category summary — no pixel data.

(function (root) {
  "use strict";

  async function execute(state, detectionIds, method) {
    // ---- Guards -------------------------------------------------------------
    if (!state.rawScreenshot) {
      return err("NO_SCREENSHOT", "No screenshot available. Call take_screenshot first.");
    }
    if (!root.ScreenshotRedactor) {
      return err("REDACTOR_UNAVAILABLE", "ScreenshotRedactor module is not loaded.");
    }

    // ---- Resolve detection IDs → detection objects -------------------------
    var resolved = root.AgentState.resolveDetectionIds(detectionIds);

    if (resolved.notFound.length > 0) {
      return err(
        "INVALID_DETECTION_IDS",
        "Unknown detection IDs: " + resolved.notFound.join(", ") +
          ". Only IDs from fuse_detections are valid."
      );
    }
    if (resolved.found.length === 0) {
      return err("NO_DETECTIONS", "No valid detections to redact.");
    }

    var viewport           = state.viewport || { width: 1280, height: 800 };
    var detectionsToRedact = resolved.found.map(function (r) { return r.detection; });

    // ---- Apply redaction via ScreenshotRedactor (OffscreenCanvas) ----------
    // TOKENIZE is handled as a label variant — ScreenshotRedactor draws a
    // category label on the opaque block either way.  The distinction is
    // cosmetic here; the mask fill is always 100% opaque.
    var screenshot = state.rawScreenshot;

    var masked;
    try {
      masked = await root.ScreenshotRedactor.redact(screenshot, detectionsToRedact, viewport);
    } catch (e) {
      return err("REDACTION_FAILED", "ScreenshotRedactor.redact() failed: " + msg(e));
    }

    // Persist masked result; keep the raw screenshot for iterative redaction
    state.redactedScreenshot = masked;

    // Track which IDs were redacted (for verify_redaction)
    var newIds = resolved.found.map(function (r) { return r.id; });
    for (var i = 0; i < newIds.length; i++) {
      if (state.redactedIds.indexOf(newIds[i]) === -1) {
        state.redactedIds.push(newIds[i]);
      }
    }

    // ---- Privacy-safe category summary for the LLM -------------------------
    var catCounts = {};
    for (var j = 0; j < detectionsToRedact.length; j++) {
      var cat = detectionsToRedact[j].category;
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }

    return {
      success: true,
      tool: "redact",
      result: {
        redactedCount:   detectionsToRedact.length,
        method:          method,
        categorySummary: catCounts,
        note: "Redaction applied. Call verify_redaction() to confirm all PII is masked.",
      },
    };
  }

  // ---------------------------------------------------------------------------
  function err(code, message) {
    return { success: false, tool: "redact", error: { code: code, message: message } };
  }
  function msg(e) { return (e && e.message) || String(e); }

  root.RedactTool = { execute: execute };
})(typeof window !== "undefined" ? window : self);
