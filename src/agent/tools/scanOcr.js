// agent/tools/scanOcr.js — Tool wrapper for OCR-based PII detection
//
// Reuses: OcrAnalyzer (Tesseract.js — fully local, no external API)
//         PatternAnalyzer (regex-based PII classifier)
//         ContextAnalyzer (label→value and NER inference)

import { ScreenshotTool }   from './screenshot.js';
import { OcrAnalyzer }      from '../../privacy/ocrAnalyzer.js';
import { PatternAnalyzer }  from '../../privacy/patternAnalyzer.js';
import { ContextAnalyzer }  from '../../privacy/contextAnalyzer.js';

async function execute(state, onProgress) {
  var progress = typeof onProgress === "function" ? onProgress : function () {};

  if (!state.rawScreenshot) {
    progress("Capturing screenshot for OCR…");
    var shotResult = await ScreenshotTool.execute(state);
    if (!shotResult.success) {
      return err(
        "NO_SCREENSHOT",
        "Screenshot not available and auto-capture failed: " +
          (shotResult.error && shotResult.error.message)
      );
    }
  }

  var ocrResult;
  try {
    ocrResult = await OcrAnalyzer.analyzeScreenshot(state.rawScreenshot, progress);
  } catch (e) {
    return err("OCR_FAILED", "OCR processing failed: " + msg(e));
  }

  state.ocrWordCount = ocrResult.words.length;

  var patternDets = [];
  if (ocrResult.words.length > 0) {
    try {
      patternDets = PatternAnalyzer.classifyWords(ocrResult.words);
    } catch (e) {
      console.warn("[Agent scanOcr] Pattern analysis error:", msg(e));
    }
  }

  var contextDets = [];
  if (ocrResult.words.length > 0) {
    try {
      contextDets = ContextAnalyzer.analyze(ocrResult.words, ocrResult.lines);
    } catch (e) {
      console.warn("[Agent scanOcr] Context analysis error:", msg(e));
    }
  }

  state.ocrDetections = patternDets.concat(contextDets);
  state._ocrWords = ocrResult.words;
  state._ocrLines = ocrResult.lines;

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

function err(code, message) {
  return { success: false, tool: "scan_ocr", error: { code: code, message: message } };
}
function msg(e) { return (e && e.message) || String(e); }

export const ScanOcrTool = { execute };
