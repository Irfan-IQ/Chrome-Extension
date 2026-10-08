// agent/tools/redact.js — Tool wrapper for screenshot redaction
//
// Reuses: ScreenshotRedactor (screenshotRedactor.js — OffscreenCanvas, fully local).

import { AgentState }        from '../agentState.js';
import { ScreenshotRedactor } from '../../privacy/screenshotRedactor.js';

async function execute(state, detectionIds, method) {
  if (!state.rawScreenshot) {
    return err("NO_SCREENSHOT", "No screenshot available. Call take_screenshot first.");
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

  if (!Array.isArray(state.redactedIds)) state.redactedIds = [];
  var newIds = resolved.found.map(function (r) { return r.id; });
  for (var i = 0; i < newIds.length; i++) {
    if (state.redactedIds.indexOf(newIds[i]) === -1) {
      state.redactedIds.push(newIds[i]);
    }
  }

  // Accumulate all detections that should be masked on the raw screenshot across turns
  var allDetectionsToRedact = state.redactedIds
    .map(function (id) { return state.detectionMap && state.detectionMap[id]; })
    .filter(Boolean);

  for (var k = 0; k < detectionsToRedact.length; k++) {
    if (allDetectionsToRedact.indexOf(detectionsToRedact[k]) === -1) {
      allDetectionsToRedact.push(detectionsToRedact[k]);
    }
  }

  var screenshot = state.rawScreenshot;

  var masked;
  try {
    masked = await ScreenshotRedactor.redact(screenshot, allDetectionsToRedact, viewport);
  } catch (e) {
    return err("REDACTION_FAILED", "ScreenshotRedactor.redact() failed: " + msg(e));
  }

  state.redactedScreenshot = masked;

  if (!Array.isArray(state.screenshotLog)) state.screenshotLog = [];
  state.screenshotLog.push({
    step:          state.stepCount,
    dataUrl:       masked,
    redactedCount: allDetectionsToRedact.length,
    autoRedacted:  false,
  });

  var catCounts = {};
  for (var j = 0; j < allDetectionsToRedact.length; j++) {
    var cat = allDetectionsToRedact[j].category;
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
