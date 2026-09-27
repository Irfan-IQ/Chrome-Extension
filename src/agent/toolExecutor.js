// agent/toolExecutor.js — Routes validated tool calls to tool implementations
//
// Every tool call reaching this module has already passed through toolValidator.js.
// SECURITY: No dynamic dispatch, no eval. Each tool name is a fixed switch/case.

import { ScanDomTool }         from './tools/scanDom.js';
import { ScreenshotTool }      from './tools/screenshot.js';
import { ScanOcrTool }         from './tools/scanOcr.js';
import { FuseDetectionsTool }  from './tools/fuseDetections.js';
import { RedactTool }          from './tools/redact.js';
import { VerifyRedactionTool } from './tools/verifyRedaction.js';
import { GetPageContextTool }  from './tools/getPageContext.js';
import { ClickElementTool }    from './tools/clickElement.js';
import { NavigateToTool }      from './tools/navigateTo.js';
import { OpenTabTool }         from './tools/openTab.js';

/**
 * Auto-capture + auto-redact a screenshot after navigation actions.
 * Calls PrivacyEngine.sanitizeCurrentPage() (still classic-loaded on window).
 * Runs silently; failures are ignored so the agent never stops because of this.
 */
async function autoCapture(state) {
  try {
    await new Promise(function (r) { setTimeout(r, 1500); });

    if (!window.PrivacyEngine ||
        typeof window.PrivacyEngine.sanitizeCurrentPage !== "function") return;

    var privResult = await window.PrivacyEngine.sanitizeCurrentPage();

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
    console.warn("[autoCapture]", e && e.message);
  }
}

async function execute(toolName, args, agentState, onProgress) {
  var s = agentState;

  switch (toolName) {
    case "scan_dom":
      return await ScanDomTool.execute(s);

    case "take_screenshot":
      return await ScreenshotTool.execute(s);

    case "scan_ocr":
      return await ScanOcrTool.execute(s, onProgress);

    case "fuse_detections":
      return FuseDetectionsTool.execute(s);

    case "redact":
      return await RedactTool.execute(s, args.detectionIds, args.method);

    case "verify_redaction":
      return VerifyRedactionTool.execute(s);

    case "get_page_context":
      return await GetPageContextTool.execute(s);

    case "click_element": {
      var clickResult = await ClickElementTool.execute(s, args);
      if (clickResult.success) await autoCapture(s);
      return clickResult;
    }

    case "navigate_to": {
      var navResult = await NavigateToTool.execute(s, args);
      if (navResult.success) await autoCapture(s);
      return navResult;
    }

    case "open_tab": {
      var tabResult = await OpenTabTool.execute(s, args);
      if (tabResult.success) await autoCapture(s);
      return tabResult;
    }

    default:
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

export const ToolExecutor = { execute };
