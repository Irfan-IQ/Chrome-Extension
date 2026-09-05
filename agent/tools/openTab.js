// agent/tools/openTab.js — Find & switch to an existing tab, or open a new one
//
// Args:
//   query    {string}  — search string matched against tab title AND url (case-insensitive)
//   url      {string}  — URL to open if no existing tab matches (http/https only)
//   new_tab  {boolean} — if true, always open a new tab (requires url)

(function (root) {
  "use strict";

  async function execute(state, args) {
    var query  = (args && typeof args.query   === "string")  ? args.query.trim().toLowerCase() : "";
    var url    = (args && typeof args.url     === "string")  ? args.url.trim()                 : "";
    var newTab = !!(args && args.new_tab);

    if (!query && !url) {
      return err("MISSING_ARGS", "Provide 'query' to search existing tabs, or 'url' to open a new tab.");
    }

    // --- Force new tab -------------------------------------------------------
    if (newTab && url) {
      if (!/^https?:\/\//i.test(url)) {
        return err("INVALID_URL", "Only http/https URLs are allowed.");
      }
      var created = await chrome.tabs.create({ url: url, active: true });
      return {
        success: true,
        tool:    "open_tab",
        result: { opened: true, url: url, note: "New tab created and focused." },
      };
    }

    // --- Search existing tabs ------------------------------------------------
    if (query) {
      var allTabs = await chrome.tabs.query({});
      var match   = null;

      for (var i = 0; i < allTabs.length; i++) {
        var t = allTabs[i];
        var titleHit = t.title && t.title.toLowerCase().includes(query);
        var urlHit   = t.url   && t.url.toLowerCase().includes(query);
        if (titleHit || urlHit) { match = t; break; }
      }

      if (match) {
        await chrome.tabs.update(match.id, { active: true });
        try { await chrome.windows.update(match.windowId, { focused: true }); } catch (_) {}
        return {
          success: true,
          tool:    "open_tab",
          result: {
            switched: true,
            title:    (match.title || "").slice(0, 100),
            note:     "Switched to existing tab.",
          },
        };
      }
    }

    // --- No existing tab matched — open URL if provided ----------------------
    if (url) {
      if (!/^https?:\/\//i.test(url)) {
        return err("INVALID_URL", "Only http/https URLs are allowed.");
      }
      var newT = await chrome.tabs.create({ url: url, active: true });
      return {
        success: true,
        tool:    "open_tab",
        result: { opened: true, url: url, note: "No matching tab found; opened new tab." },
      };
    }

    return err(
      "NOT_FOUND",
      "No open tab matched query '" + query + "' and no fallback URL was provided."
    );
  }

  // --------------------------------------------------------------------------
  function err(code, message) {
    return { success: false, tool: "open_tab", error: { code: code, message: message } };
  }

  root.OpenTabTool = { execute: execute };
})(typeof window !== "undefined" ? window : self);
