// agent/tools/scanDom.js — Tool wrapper for DOM-based PII detection
//
// Reuses: privacy/coordinateUtils.js, privacy/detector.js, privacy/contentScript.js
// Those modules are injected into the active tab's page context via chrome.scripting.
//
// PRIVACY: Only category + count metadata is returned to the LLM.
//          Detections with rects, selectors, and element handles are stored
//          locally in agentState and NEVER forwarded to the LLM.

(function (root) {
  "use strict";

  var PAGE_MODULES = [
    "privacy/coordinateUtils.js",
    "privacy/detector.js",
    "privacy/contentScript.js",
  ];

  var RESTRICTED_SCHEME = /^(chrome|chrome-extension|edge|about|devtools|view-source|moz-extension):/i;

  async function execute(state) {
    // ---- Get active tab -------------------------------------------------------
    var tab;
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs && tabs[0];
    } catch (e) {
      return err("TAB_ERROR", "Could not query active tab: " + msg(e));
    }

    if (!tab || !tab.id || tab.id < 0) {
      return err("NO_TAB", "No active tab found.");
    }

    var url = tab.url || tab.pendingUrl || "";
    if (RESTRICTED_SCHEME.test(url)) {
      return err(
        "RESTRICTED_PAGE",
        "This is a browser-internal page (" + url.split(":")[0] + ":) and cannot be scanned."
      );
    }

    // ---- Inject privacy modules into the page --------------------------------
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        files: PAGE_MODULES,
      });
    } catch (e) {
      return err("INJECT_FAILED", "Could not inject privacy engine into page: " + msg(e));
    }

    // ---- Run DOM scan via the content bridge ---------------------------------
    var res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type: "PRIVACY_SCAN" });
    } catch (e) {
      res = null;
    }

    if (!res || !res.ok) {
      return err("SCAN_FAILED", (res && res.error) || "Content script did not respond.");
    }

    // ---- Store locally in agent state ---------------------------------------
    state.domDetections  = res.detections     || [];
    state.viewport       = res.viewport       || { width: 1280, height: 800 };
    state.uninspectable  = res.uninspectable  || [];
    state._tabId         = tab.id;
    state._windowId      = tab.windowId;
    state.currentPage.url   = tab.url   || "";
    state.currentPage.title = tab.title || "";

    // ---- Build privacy-safe summary for the LLM -----------------------------
    var catCounts = {};
    for (var i = 0; i < state.domDetections.length; i++) {
      var cat = state.domDetections[i].category;
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }

    return {
      success: true,
      tool: "scan_dom",
      result: {
        detectionCount:     state.domDetections.length,
        categorySummary:    catCounts,
        uninspectableCount: state.uninspectable.length,
        note: "DOM scan complete. Call fuse_detections (with or without scan_ocr) to assign IDs.",
      },
    };
  }

  // ---------------------------------------------------------------------------
  function err(code, message) {
    return { success: false, tool: "scan_dom", error: { code: code, message: message } };
  }
  function msg(e) { return (e && e.message) || String(e); }

  root.ScanDomTool = { execute: execute };
})(typeof window !== "undefined" ? window : self);
