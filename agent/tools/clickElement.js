// agent/tools/clickElement.js — Click an element on the active page
//
// Supports two targeting modes (at least one required):
//   selector — CSS selector string (e.g. "a[href='/repositories']")
//   text      — visible label text (e.g. "Repositories") — matched
//               case-insensitively against textContent of clickable elements.
//
// SECURITY: The CSS selector and text string are passed as plain data arguments
// to a fixed injected function — no dynamic code is generated or eval'd.

(function (root) {
  "use strict";

  async function execute(state, args) {
    var selector = (args && typeof args.selector === "string") ? args.selector.trim() : "";
    var text     = (args && typeof args.text     === "string") ? args.text.trim()     : "";

    if (!selector && !text) {
      return err("MISSING_ARGS", "Provide 'selector' (CSS) or 'text' (visible label) — or both.");
    }

    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab  = tabs && tabs[0];
    if (!tab) return err("NO_TAB", "No active tab found.");

    var results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function (sel, txt) {
          var el = null;

          // --- CSS selector ------------------------------------------------
          if (sel) {
            try { el = document.querySelector(sel); } catch (e) { /* bad selector — fall through */ }
          }

          // --- Text search -------------------------------------------------
          // Walk clickable / tab-like elements, pick first visible text match.
          if (!el && txt) {
            var lower = txt.toLowerCase();
            var TAGS  = "a, button, [role='tab'], [role='link'], [role='menuitem'], li, span";
            var nodes = Array.from(document.querySelectorAll(TAGS));
            for (var i = 0; i < nodes.length; i++) {
              var c = nodes[i];
              // offsetParent === null means the element is hidden
              if (c.offsetParent !== null &&
                  c.textContent.trim().toLowerCase().includes(lower)) {
                el = c;
                break;
              }
            }
          }

          if (!el) return { found: false };

          el.click();
          return {
            found:  true,
            tag:    el.tagName,
            label:  el.textContent.trim().slice(0, 80),
          };
        },
        args: [selector, text],
      });
    } catch (e) {
      return err("SCRIPT_FAILED", "Could not inject click script: " + msg(e));
    }

    var r = results && results[0] && results[0].result;
    if (!r || !r.found) {
      return err(
        "NOT_FOUND",
        "No visible element matched" +
          (selector ? " selector='" + selector + "'" : "") +
          (text     ? " text='"     + text     + "'" : "") + "."
      );
    }

    return {
      success: true,
      tool:    "click_element",
      result: {
        clicked: true,
        tag:     r.tag,
        label:   r.label,
      },
    };
  }

  // --------------------------------------------------------------------------
  function err(code, message) {
    return { success: false, tool: "click_element", error: { code: code, message: message } };
  }
  function msg(e) { return (e && e.message) || String(e); }

  root.ClickElementTool = { execute: execute };
})(typeof window !== "undefined" ? window : self);
