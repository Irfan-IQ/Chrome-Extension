// agent/tools/screenshot.js — Capture the active tab screenshot
//
// The raw screenshot (PNG data URL) is stored ONLY in agentState.rawScreenshot.
// It is NEVER returned to the LLM, never logged, and never sent externally.
// The LLM only receives the image dimensions and a status note.

(function (root) {
  "use strict";

  async function execute(state) {
    // Ensure we know the window ID (try tab lookup if needed)
    if (!state._windowId) {
      try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        var tab  = tabs && tabs[0];
        if (tab) {
          state._tabId    = tab.id;
          state._windowId = tab.windowId;
        }
      } catch (e) { /* ignore */ }
    }

    if (!state._windowId) {
      return err("NO_WINDOW", "Could not determine window ID for screenshot capture.");
    }

    var dataUrl;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(state._windowId, { format: "png" });
    } catch (e) {
      return err("CAPTURE_FAILED", "Screenshot capture failed: " + msg(e));
    }

    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
      return err("CAPTURE_EMPTY", "Screenshot capture returned an invalid result.");
    }

    // Store locally — never exposed to LLM
    state.rawScreenshot = dataUrl;

    // Measure dimensions (needed for coordinate mapping later)
    var dims = await getImageDimensions(dataUrl);
    state.screenshotSize = { width: dims.width, height: dims.height };

    return {
      success: true,
      tool: "take_screenshot",
      result: {
        width:  dims.width,
        height: dims.height,
        note:   "Screenshot captured and stored locally. Available for OCR and redaction.",
      },
    };
  }

  // ---------------------------------------------------------------------------
  function getImageDimensions(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload  = function () { resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = function () { reject(new Error("Cannot read screenshot dimensions.")); };
      img.src = dataUrl;
    });
  }

  function err(code, message) {
    return { success: false, tool: "take_screenshot", error: { code: code, message: message } };
  }
  function msg(e) { return (e && e.message) || String(e); }

  root.ScreenshotTool = { execute: execute };
})(typeof window !== "undefined" ? window : self);
