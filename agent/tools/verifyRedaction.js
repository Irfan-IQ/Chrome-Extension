// agent/tools/verifyRedaction.js — Verify that redaction is complete
//
// Compares all assigned detection IDs against the set of IDs that have
// been passed to the redact tool. Returns the remaining count so the LLM
// can decide whether the task is complete or whether another redact() call
// is needed.
//
// This is what makes the agent genuinely iterative:
//   LLM → redact() → verify_redaction() → if remaining > 0 → redact() again

(function (root) {
  "use strict";

  function execute(state) {
    var allIds      = Object.keys(state.detectionMap || {});
    var redactedIds = state.redactedIds || [];

    if (allIds.length === 0) {
      // fuse_detections has not been run yet
      return {
        success: true,
        tool: "verify_redaction",
        result: {
          totalDetections: 0,
          redactedCount:   0,
          remainingCount:  0,
          remainingDetections: [],
          verified: false,
          note: "No detections found in state. Run scan_dom / scan_ocr and fuse_detections first.",
        },
      };
    }

    // Determine which IDs are still unredacted
    var remaining = allIds.filter(function (id) {
      return redactedIds.indexOf(id) === -1;
    });

    // Build metadata-only list of remaining items (safe for LLM)
    var remainingMeta = remaining.map(function (id) {
      var det = state.detectionMap[id];
      return {
        id:         id,
        category:   det ? det.category   : "unknown",
        confidence: det ? (typeof det.confidence === "number"
          ? Math.round(det.confidence * 100) / 100
          : det.confidence) : 0,
        sources:    det ? (det.sources || ["dom"]) : [],
      };
    });

    var verified = remaining.length === 0;

    return {
      success: true,
      tool: "verify_redaction",
      result: {
        totalDetections:     allIds.length,
        redactedCount:       redactedIds.length,
        remainingCount:      remaining.length,
        remainingDetections: remainingMeta,
        verified:            verified,
        note: verified
          ? "All " + redactedIds.length + " detected region(s) have been redacted. Task complete."
          : remaining.length + " region(s) still need redaction. " +
            "Call redact() with the remaining IDs from remainingDetections.",
      },
    };
  }

  root.VerifyRedactionTool = { execute: execute };
})(typeof window !== "undefined" ? window : self);
