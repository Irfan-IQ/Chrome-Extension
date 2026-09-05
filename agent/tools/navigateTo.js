// agent/tools/navigateTo.js — Navigate the active tab to a URL
//
// Only http:// and https:// URLs are accepted — javascript: and other
// schemes are rejected before the chrome.tabs.update call.

(function (root) {
  "use strict";

  async function execute(state, args) {
    var url = (args && typeof args.url === "string") ? args.url.trim() : "";

    if (!url) {
      return err("MISSING_URL", "A 'url' argument is required.");
    }

    // Security: only plain web URLs
    if (!/^https?:\/\//i.test(url)) {
      return err(
        "INVALID_URL",
        "Only http:// and https:// URLs are allowed. Got: " + url.slice(0, 80)
      );
    }

    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab  = tabs && tabs[0];
    if (!tab) return err("NO_TAB", "No active tab found.");

    try {
      await chrome.tabs.update(tab.id, { url: url });
      return {
        success: true,
        tool:    "navigate_to",
        result: {
          navigated: true,
          url:       url,
          note:      "Navigation started. The page is loading.",
        },
      };
    } catch (e) {
      return err("NAV_FAILED", "Navigation failed: " + msg(e));
    }
  }

  // --------------------------------------------------------------------------
  function err(code, message) {
    return { success: false, tool: "navigate_to", error: { code: code, message: message } };
  }
  function msg(e) { return (e && e.message) || String(e); }

  root.NavigateToTool = { execute: execute };
})(typeof window !== "undefined" ? window : self);
