// agent/agentManager.js — Central agent orchestration loop
//
// Implements the REASON → ACT → OBSERVE → REASON cycle. See docs/ARCHITECTURE.md.

import { AgentState }     from './agentState.js';
import { ToolRegistry }   from './toolRegistry.js';
import { ToolValidator }  from './toolValidator.js';
import { ToolExecutor }   from './toolExecutor.js';
import { AgentLLMClient } from './llmClient.js';

var MAX_AGENT_STEPS        = 15;
var MAX_SAME_TOOL_IN_A_ROW = 2;

async function run(userRequest, apiKey, onStep) {
  var notify = typeof onStep === "function" ? onStep : function () {};

  var state    = AgentState.init(userRequest);
  var toolDefs = ToolRegistry.getDefinitions();

  var messages = [
    { role: "user", parts: [{ text: userRequest }] },
  ];

  var toolRunCount = {};
  var lastToolName = null;

  var finalSummary = "";
  var taskDone     = false;

  while (!taskDone && state.stepCount < MAX_AGENT_STEPS) {
    state.stepCount++;
    var t0 = Date.now();

    var llmResponse;
    try {
      llmResponse = await AgentLLMClient.generateWithTools(messages, toolDefs, apiKey);
    } catch (llmErr) {
      var errText = (llmErr && llmErr.message) || "LLM call failed.";
      AgentState.addError(errText);
      notify({ step: state.stepCount, tool: "llm", status: "error",
               message: "LLM error: " + errText, duration: Date.now() - t0 });
      return { success: false, summary: "Agent stopped — LLM error: " + errText,
               state: state, redactedScreenshot: null, screenshotLog: state.screenshotLog || [] };
    }

    if (llmResponse.type === "text") {
      finalSummary = llmResponse.text;
      taskDone     = true;
      if (llmResponse.rawContent) messages.push(llmResponse.rawContent);
      notify({ step: state.stepCount, tool: "done", status: "complete",
               message: "Task completed.", duration: Date.now() - t0 });
      break;
    }

    if (llmResponse.type !== "tool_call") {
      return { success: false, summary: "Unexpected LLM response type: " + llmResponse.type,
               state: state, redactedScreenshot: null, screenshotLog: state.screenshotLog || [] };
    }

    var toolCall = llmResponse.toolCall;
    var toolName = toolCall.name || "unknown";

    if (llmResponse.rawContent) messages.push(llmResponse.rawContent);

    var validation = ToolValidator.validate(toolCall);
    if (!validation.valid) {
      var valErr = "Validation failed for '" + toolName + "': " + validation.error;
      AgentState.addError(valErr);

      messages.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: toolName,
            response: { success: false,
              error: { code: "VALIDATION_FAILED", message: validation.error } },
          },
        }],
      });

      notify({ step: state.stepCount, tool: toolName, status: "rejected",
               message: "Rejected: " + validation.error, duration: Date.now() - t0 });
      continue;
    }

    if (toolName === lastToolName) {
      toolRunCount[toolName] = (toolRunCount[toolName] || 0) + 1;
    } else {
      toolRunCount[toolName] = 1;
      lastToolName = toolName;
    }

    if (toolRunCount[toolName] > MAX_SAME_TOOL_IN_A_ROW) {
      var loopMsg = "Tool '" + toolName + "' called " +
        toolRunCount[toolName] + " consecutive times without progress. Stopping.";
      AgentState.addError(loopMsg);
      return { success: false, summary: loopMsg, state: state,
               redactedScreenshot: state.redactedScreenshot || null, screenshotLog: state.screenshotLog || [] };
    }

    var toolResult;
    try {
      toolResult = await ToolExecutor.execute(
        toolName,
        toolCall.args || {},
        state,
        function (progressMsg) {
          notify({ step: state.stepCount, tool: toolName, status: "working",
                   message: progressMsg, duration: 0 });
        }
      );
    } catch (execErr) {
      toolResult = {
        success: false,
        tool:    toolName,
        error: {
          code:    "EXECUTOR_ERROR",
          message: (execErr && execErr.message) || "Execution failed.",
        },
      };
    }

    state.executedTools.push({
      tool:      toolName,
      success:   toolResult.success,
      timestamp: Date.now(),
    });

    if (toolResult.success) toolRunCount[toolName] = 0;

    var stepEntry = {
      step:     state.stepCount,
      tool:     toolName,
      status:   toolResult.success ? "success" : "error",
      message:  buildStepMessage(toolName, toolResult),
      duration: Date.now() - t0,
    };
    AgentState.addStepLog(
      stepEntry.step, stepEntry.tool, stepEntry.status,
      stepEntry.message, stepEntry.duration
    );
    notify(stepEntry);

    var funcResp = AgentLLMClient.buildFunctionResponseMessage(toolName, toolResult);
    messages.push(funcResp);
  }

  if (!taskDone) {
    finalSummary =
      "The agent reached the maximum of " + MAX_AGENT_STEPS + " steps without completing. " +
      "Last action: " +
      (state.executedTools.length
        ? state.executedTools[state.executedTools.length - 1].tool
        : "none") +
      ". You can run the agent again to continue.";
  }

  state.completed = true;

  return {
    success:            taskDone,
    summary:            finalSummary,
    state:              state,
    redactedScreenshot: state.redactedScreenshot || null,
    screenshotLog:      state.screenshotLog || [],
  };
}

function buildStepMessage(toolName, result) {
  if (!result.success) {
    return (result.error && result.error.message) || "Failed.";
  }
  var r = result.result || {};
  switch (toolName) {
    case "scan_dom":
      return "Found " + (r.detectionCount || 0) + " DOM detection(s)" +
        (r.categorySummary ? " — " + summariseCats(r.categorySummary) : "") + ".";
    case "take_screenshot":
      return "Screenshot captured (" + (r.width || "?") + "×" + (r.height || "?") + " px).";
    case "scan_ocr":
      return "OCR: " + (r.ocrWordCount || 0) + " words, " + (r.detectionCount || 0) + " detection(s)" +
        (r.categorySummary ? " — " + summariseCats(r.categorySummary) : "") + ".";
    case "fuse_detections":
      return "Fused to " + (r.totalDetections || 0) + " unique detection(s)" +
        (r.categorySummary ? " — " + summariseCats(r.categorySummary) : "") +
        (r.visionEnabled ? " — local vision active." : "") + ".";
    case "redact":
      return "Redacted " + (r.redactedCount || 0) + " region(s)" +
        (r.categorySummary ? " — " + summariseCats(r.categorySummary) : "") + ".";
    case "verify_redaction":
      return r.verified
        ? "✓ Verified — all " + (r.redactedCount || 0) + " region(s) masked."
        : "⚠ " + (r.remainingCount || 0) + " region(s) still need redaction.";
    case "get_page_context":
      return "Page: " + (r.host || "unknown") + (r.title ? " — " + r.title.slice(0, 40) : "");
    default:
      return "Completed.";
  }
}

function summariseCats(cats) {
  if (!cats || typeof cats !== "object") return "";
  return Object.keys(cats).map(function (k) { return cats[k] + " " + k; }).join(", ");
}

export const AgentManager = { run, MAX_AGENT_STEPS };
