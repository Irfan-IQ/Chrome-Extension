// agent/toolExecutor.js — Routes validated tool calls to tool implementations
//
// Every tool call that reaches this module has already passed through
// toolValidator.js. This module maps tool names to trusted, registered
// tool functions — only those functions, nothing else.
//
// SECURITY: No dynamic dispatch, no eval, no arbitrary code paths.
//           Each tool name is matched against a fixed switch/case.

(function (root) {
  "use strict";

  /**
   * Auto-capture + auto-redact a screenshot after navigation actions.
   * Calls PrivacyEngine.sanitizeCurrentPage() directly — the same pipeline
   * chat mode uses — so the gallery only ever stores redacted images.
   * Runs silently; failures are ignored so the agent never stops because of this.
   */
  async function autoCapture(state) {
    try {
      // Let the page settle after navigation / click
      await new Promise(function (r) { setTimeout(r, 1500); });

      if (!root.PrivacyEngine ||
          typeof root.PrivacyEngine.sanitizeCurrentPage !== "function") return;

      var privResult = await root.PrivacyEngine.sanitizeCurrentPage();

      if (privResult && privResult.sanitizedScreenshot) {
        if (!Array.isArray(state.screenshotLog)) state.screenshotLog = [];
        state.screenshotLog.push({
          step:          state.stepCount,
          dataUrl:       privResult.sanitizedScreenshot,
          redactedCount: privResult.detectedElements
                         ? privResult.detectedElements.length : 0,
          autoRedacted:  true,
        });
      }

      // Make the raw screenshot available for the redact tool if it runs later
      if (privResult && privResult.beforeScreenshot) {
        state.rawScreenshot = privResult.beforeScreenshot;
        if (privResult.sanitizedScreenshot) {
          var img = new Image();
          img.onload = function () {
            state.screenshotSize = { width: img.naturalWidth, height: img.naturalHeight };
          };
          img.src = privResult.beforeScreenshot;
        }
      }
    } catch (e) {
      // Non-fatal — agent continues; this entry is simply skipped in the gallery
      console.warn("[autoCapture]", e && e.message);
    }
  }

  /**
   * Execute a validated tool call.
   *
   * @param {string}   toolName    - The tool to execute (already validated)
   * @param {object}   args        - Tool arguments (already validated)
   * @param {object}   agentState  - Current agent state object
   * @param {function} [onProgress] - Optional progress callback
   * @returns {Promise<object>}    - Structured tool result
   */
  async function execute(toolName, args, agentState, onProgress) {
    var s = agentState;

    switch (toolName) {
      case "scan_dom":
        return await root.ScanDomTool.execute(s);

      case "take_screenshot":
        return await root.ScreenshotTool.execute(s);

      case "scan_ocr":
        return await root.ScanOcrTool.execute(s, onProgress);

      case "fuse_detections":
        return root.FuseDetectionsTool.execute(s);

      case "redact":
        return await root.RedactTool.execute(s, args.detectionIds, args.method);

      case "verify_redaction":
        return root.VerifyRedactionTool.execute(s);

      case "get_page_context":
        return await root.GetPageContextTool.execute(s);

      case "click_element": {
        var clickResult = await root.ClickElementTool.execute(s, args);
        if (clickResult.success) await autoCapture(s);
        return clickResult;
      }

      case "navigate_to": {
        var navResult = await root.NavigateToTool.execute(s, args);
        if (navResult.success) await autoCapture(s);
        return navResult;
      }

      case "open_tab": {
        var tabResult = await root.OpenTabTool.execute(s, args);
        if (tabResult.success) await autoCapture(s);
        return tabResult;
      }

      default:
        // Should be unreachable — toolValidator rejects unknown names first.
        return {
          success: false,
          tool: toolName,
          error: {
            code:    "UNKNOWN_TOOL",
            message: "No executor is registered for tool: " + String(toolName).slice(0, 40),
          },
        };
    }
  }

  root.ToolExecutor = { execute: execute };
})(typeof window !== "undefined" ? window : self);
