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

      case "click_element":
        return await root.ClickElementTool.execute(s, args);

      case "navigate_to":
        return await root.NavigateToTool.execute(s, args);

      case "open_tab":
        return await root.OpenTabTool.execute(s, args);

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
