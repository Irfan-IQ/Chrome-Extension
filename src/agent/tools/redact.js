// agent/tools/redact.js — Tool wrapper for screenshot redaction
//
// Reuses: ScreenshotRedactor (screenshotRedactor.js — OffscreenCanvas, fully local)
// ScreenshotRedactor is still classic-loaded and lives on window.

import { AgentState } from '../agentState.js';

async function execute(state, detectionIds, method) {
  if (!state.rawScreenshot) {
    return err("NO_SCREENSHOT", "No screenshot available. Call take_screenshot first.");
  }
  if (!window.ScreenshotRedactor) {
    return err("REDACTOR_UNAVAILABLE", "ScreenshotRedactor module is not loaded.");
  }

  var resolved = AgentState.resolveDetectionIds(detectionIds);

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

  var screenshot = state.rawScreenshot;

  var masked;
  try {
    masked = await window.ScreenshotRedactor.redact(screenshot, detectionsToRedact, viewport);
  } catch (e) {
    return err("REDACTION_FAILED", "ScreenshotRedactor.redact() failed: " + msg(e));
  }

  state.redactedScreenshot = masked;

  if (!Array.isArray(state.screenshotLog)) state.screenshotLog = [];
  state.screenshotLog.push({
    step:          state.stepCount,
    dataUrl:       masked,
    redactedCount: detectionsToRedact.length,
    autoRedacted:  false,
  });

  var newIds = resolved.found.map(function (r) { return r.id; });
  for (var i = 0; i < newIds.length; i++) {
    if (state.redactedIds.indexOf(newIds[i]) === -1) {
      state.redactedIds.push(newIds[i]);
    }
  }

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

function err(code, message) {
  return { success: false, tool: "redact", error: { code: code, message: message } };
}
function msg(e) { return (e && e.message) || String(e); }

export const RedactTool = { execute };
