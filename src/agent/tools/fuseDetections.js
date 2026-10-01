// agent/tools/fuseDetections.js — Tool wrapper for detection fusion
//
// Reuses: DetectionFusion (detectionFusion.js) — merges DOM + OCR detections,
//         scores confidence, and deduplicates overlapping regions.

import { AgentState }       from '../agentState.js';
import { ScreenshotTool }   from './screenshot.js';
import { DetectionFusion }  from '../../privacy/detectionFusion.js';
import { VisionEngine }     from '../../vision/visionEngine.js';

async function execute(state) {
  var dom            = state.domDetections   || [];
  var ocr            = state.ocrDetections   || [];
  var viewport       = state.viewport         || { width: 1280, height: 800 };
  var screenshotSize = state.screenshotSize;
  var vision         = state.visionDetections || [];

  if (vision.length === 0) {
    try {
      if (!state.rawScreenshot) {
        await ScreenshotTool.execute(state);
      }

      screenshotSize = state.screenshotSize;
      if (state.rawScreenshot) {
        var visionResult = await VisionEngine.detectScreenshot(state.rawScreenshot);
        vision = visionResult.detections || [];
        state.visionDetections = vision;
        state.visionSummary = visionResult.visionSummary || null;
      }
    } catch (e) {
      console.warn("[Agent fuseDetections] Vision scan failed:", e && e.message);
    }
  }

  var fused;

  if (ocr.length > 0 && screenshotSize) {
    try {
      fused = DetectionFusion.fuse(
        dom,
        ocr.concat(vision),
        viewport,
        screenshotSize
      );
    } catch (e) {
      console.warn("[Agent fuseDetections] DetectionFusion.fuse failed, using DOM-only fallback:", e && e.message);
      fused = domOnlyFallback(dom);
    }
  } else if (screenshotSize && vision.length > 0) {
    try {
      fused = DetectionFusion.fuse([], vision, viewport, screenshotSize)
        .concat(domOnlyFallback(dom));
    } catch (e) {
      console.warn("[Agent fuseDetections] Vision-only fusion failed:", e && e.message);
      fused = domOnlyFallback(dom);
    }
  } else {
    fused = domOnlyFallback(dom);
  }

  AgentState.assignDetectionIds(fused);

  var metadata  = AgentState.getDetectionMetadata();
  var catCounts = {};
  for (var i = 0; i < metadata.length; i++) {
    var cat = metadata[i].category;
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }

  return {
    success: true,
    tool: "fuse_detections",
    result: {
      totalDetections: metadata.length,
      categorySummary: catCounts,
      visionEnabled:   vision.length > 0,
      visionSummary:   state.visionSummary || null,
      detections:      metadata,
      note: metadata.length > 0
        ? "Fused " + metadata.length + " detection(s). Pass desired IDs to redact()."
        : "No detections found. The page may not contain detectable PII in the current view.",
    },
  };
}

function domOnlyFallback(dom) {
  return dom.map(function (d) {
    var conf = d.confidence === "high"   ? 0.85
             : d.confidence === "medium" ? 0.65
             : typeof d.confidence === "number" ? d.confidence
             : 0.50;
    return Object.assign({}, d, {
      confidence:      conf,
      confidenceLabel: d.confidence,
      sources:         ["dom"],
    });
  });
}

export const FuseDetectionsTool = { execute };
