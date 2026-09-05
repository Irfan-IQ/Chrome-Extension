// agent/tools/fuseDetections.js — Tool wrapper for detection fusion
//
// Reuses: DetectionFusion (detectionFusion.js) — merges DOM + OCR detections,
//         scores confidence, and deduplicates overlapping regions.
//
// After fusion, stable detection IDs ("det_0", "det_1", …) are assigned via
// AgentState.assignDetectionIds(). The LLM receives the IDs + metadata only;
// raw rects, element handles, and matched text stay local.

(function (root) {
  "use strict";

  function execute(state) {
    var dom           = state.domDetections   || [];
    var ocr           = state.ocrDetections   || [];
    var viewport      = state.viewport        || { width: 1280, height: 800 };
    var screenshotSize= state.screenshotSize;

    var fused;

    if (root.DetectionFusion && ocr.length > 0 && screenshotSize) {
      // Full fusion path: DOM + OCR merged with IoU-based spatial matching
      try {
        fused = root.DetectionFusion.fuse(dom, ocr, viewport, screenshotSize);
      } catch (e) {
        console.warn("[Agent fuseDetections] DetectionFusion.fuse failed, using DOM-only fallback:", e && e.message);
        fused = domOnlyFallback(dom);
      }
    } else {
      // Fallback: OCR not run or screenshot size unknown — use DOM detections only
      fused = domOnlyFallback(dom);
    }

    // Assign stable IDs and build the detection map in agentState
    root.AgentState.assignDetectionIds(fused);

    // Return metadata safe to send to LLM
    var metadata  = root.AgentState.getDetectionMetadata();
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
        detections:      metadata,   // [{id, category, confidence, sources}]
        note: metadata.length > 0
          ? "Fused " + metadata.length + " detection(s). Pass desired IDs to redact()."
          : "No detections found. The page may not contain detectable PII in the current view.",
      },
    };
  }

  // ---------------------------------------------------------------------------
  // DOM-only fallback: map raw DOM detections to the fused detection format
  // ---------------------------------------------------------------------------
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

  root.FuseDetectionsTool = { execute: execute };
})(typeof window !== "undefined" ? window : self);
