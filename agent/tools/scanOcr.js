// agent/tools/scanOcr.js — Tool wrapper for OCR-based PII detection
//
// Reuses: OcrAnalyzer (Tesseract.js — fully local, no external API)
//         PatternAnalyzer (regex-based PII classifier)
//         ContextAnalyzer (label→value and NER inference)
//
// PRIVACY: All OCR processing runs locally in the browser.
//          Only detection counts and category metadata are returned.
//          OCR words, lines, and matched text values stay in agentState
//          and are NEVER forwarded to the LLM.

(function (root) {
  "use strict";

  async function execute(state, onProgress) {
    var progress = typeof onProgress === "function" ? onProgress : function () {};

    // ---- Ensure screenshot is available -------------------------------------
    if (!state.rawScreenshot) {
      progress("Capturing screenshot for OCR…");
      var shotResult = await root.ScreenshotTool.execute(state);
      if (!shotResult.success) {
        return err(
          "NO_SCREENSHOT",
          "Screenshot not available and auto-capture failed: " +
            (shotResult.error && shotResult.error.message)
        );
      }
    }

    // ---- OCR ----------------------------------------------------------------
    if (!root.OcrAnalyzer) {
      return err("OCR_UNAVAILABLE", "OcrAnalyzer module is not loaded.");
    }

    var ocrResult;
    try {
      ocrResult = await root.OcrAnalyzer.analyzeScreenshot(state.rawScreenshot, progress);
    } catch (e) {
      return err("OCR_FAILED", "OCR processing failed: " + msg(e));
    }

    state.ocrWordCount = ocrResult.words.length;

    // ---- Pattern classification of OCR words --------------------------------
    var patternDets = [];
    if (root.PatternAnalyzer && ocrResult.words.length > 0) {
      try {
        patternDets = root.PatternAnalyzer.classifyWords(ocrResult.words);
      } catch (e) {
        console.warn("[Agent scanOcr] Pattern analysis error:", msg(e));
      }
    }

    // ---- Context / NER analysis on OCR lines --------------------------------
    var contextDets = [];
    if (root.ContextAnalyzer && ocrResult.words.length > 0) {
      try {
        contextDets = root.ContextAnalyzer.analyze(ocrResult.words, ocrResult.lines);
      } catch (e) {
        console.warn("[Agent scanOcr] Context analysis error:", msg(e));
      }
    }

    // ---- Store locally in agent state ---------------------------------------
    state.ocrDetections = patternDets.concat(contextDets);
    // Keep raw OCR data for fusion (needed for bounding-box conversion)
    state._ocrWords = ocrResult.words;
    state._ocrLines = ocrResult.lines;

    // ---- Build privacy-safe summary for the LLM -----------------------------
    var catCounts = {};
    for (var i = 0; i < state.ocrDetections.length; i++) {
      var cat = state.ocrDetections[i].category;
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }

    return {
      success: true,
      tool: "scan_ocr",
      result: {
        ocrWordCount:          state.ocrWordCount,
        detectionCount:        state.ocrDetections.length,
        patternDetectionCount: patternDets.length,
        contextDetectionCount: contextDets.length,
        categorySummary:       catCounts,
        note: "OCR scan complete. Call fuse_detections to merge with DOM results.",
      },
    };
  }

  // ---------------------------------------------------------------------------
  function err(code, message) {
    return { success: false, tool: "scan_ocr", error: { code: code, message: message } };
  }
  function msg(e) { return (e && e.message) || String(e); }

  root.ScanOcrTool = { execute: execute };
})(typeof window !== "undefined" ? window : self);
