// agent/tools/getPageContext.js — Return basic page metadata safe to send to LLM
//
// Returns: hostname, document title, viewport dimensions.
// Does NOT return any page content, DOM structure, or sensitive values.

(function (root) {
  "use strict";

  async function execute(state) {
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab  = tabs && tabs[0];
      if (!tab) {
        return err("NO_TAB", "No active tab found.");
      }

      var host = "";
      try { host = new URL(tab.url || "").host; } catch (e) { /* ignore */ }

      var vp = state.viewport || {};

      return {
        success: true,
        tool: "get_page_context",
        result: {
          host:            host,
          title:           tab.title || "",
          viewportWidth:   vp.width  || "unknown",
          viewportHeight:  vp.height || "unknown",
          note: "Basic metadata only. No page content or sensitive data included.",
        },
      };
    } catch (e) {
      return err("CONTEXT_FAILED", "Could not retrieve page context: " + msg(e));
    }
  }

  // ---------------------------------------------------------------------------
  function err(code, message) {
    return { success: false, tool: "get_page_context", error: { code: code, message: message } };
  }
  function msg(e) { return (e && e.message) || String(e); }

  root.GetPageContextTool = { execute: execute };
})(typeof window !== "undefined" ? window : self);
