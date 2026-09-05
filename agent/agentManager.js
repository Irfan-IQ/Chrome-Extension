// agent/agentManager.js — Central agent orchestration loop
//
// Implements the REASON → ACT → OBSERVE → REASON cycle:
//
//   User request
//       ↓
//   LLM (with tool definitions)     ← AgentLLMClient.generateWithTools()
//       ↓
//   Tool call (untrusted LLM output)
//       ↓
//   ToolValidator.validate()         ← security boundary
//       ↓
//   ToolExecutor.execute()           ← trusted extension code
//       ↓
//   Existing privacy modules         ← DOM / OCR / fusion / redaction
//       ↓
//   Structured result (metadata only)
//       ↓
//   LLM (receives result, plans next action)
//       ↓
//   … repeat until task complete or MAX_STEPS reached
//
// SECURITY INVARIANTS maintained throughout:
//   • LLM output is always treated as untrusted input.
//   • Every tool call is validated before execution.
//   • Raw PII never leaves the local extension.
//   • The LLM cannot execute arbitrary JavaScript.
//   • Loop is bounded by MAX_AGENT_STEPS.

(function (root) {
  "use strict";

  var MAX_AGENT_STEPS           = 10;
  var MAX_SAME_TOOL_IN_A_ROW    = 2;   // repeated-loop protection

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  /**
   * Run the agent for a single user request.
   *
   * @param {string}   userRequest  - Natural language task from the user
   * @param {string}   apiKey       - Gemini API key
   * @param {function} [onStep]     - Called with a step-log object after each step
   * @returns {Promise<{
   *   success: boolean,
   *   summary: string,
   *   state:   object,
   *   redactedScreenshot: string|null
   * }>}
   */
  async function run(userRequest, apiKey, onStep) {
    var notify = typeof onStep === "function" ? onStep : function () {};

    // ---- Initialize session state -------------------------------------------
    var state    = root.AgentState.init(userRequest);
    var toolDefs = root.ToolRegistry.getDefinitions();

    // ---- Build initial conversation -----------------------------------------
    var messages = [
      { role: "user", parts: [{ text: userRequest }] },
    ];

    // Loop-protection: track consecutive calls to the same tool
    var toolRunCount = {};     // { toolName: consecutiveCount }
    var lastToolName = null;

    var finalSummary = "";
    var taskDone     = false;

    // ---- Agent loop ---------------------------------------------------------
    while (!taskDone && state.stepCount < MAX_AGENT_STEPS) {
      state.stepCount++;
      var t0 = Date.now();

      // --- Step A: Ask the LLM what to do next --------------------------------
      var llmResponse;
      try {
        llmResponse = await root.AgentLLMClient.generateWithTools(messages, toolDefs, apiKey);
      } catch (llmErr) {
        var errText = (llmErr && llmErr.message) || "LLM call failed.";
        root.AgentState.addError(errText);
        notify({ step: state.stepCount, tool: "llm", status: "error",
                 message: "LLM error: " + errText, duration: Date.now() - t0 });
        return { success: false, summary: "Agent stopped — LLM error: " + errText,
                 state: state, redactedScreenshot: null };
      }

      // --- Step B: Did the LLM emit a final text answer? ----------------------
      if (llmResponse.type === "text") {
        finalSummary = llmResponse.text;
        taskDone     = true;
        if (llmResponse.rawContent) messages.push(llmResponse.rawContent);
        notify({ step: state.stepCount, tool: "done", status: "complete",
                 message: "Task completed.", duration: Date.now() - t0 });
        break;
      }

      // --- Step C: Handle a tool call -----------------------------------------
      if (llmResponse.type !== "tool_call") {
        return { success: false, summary: "Unexpected LLM response type: " + llmResponse.type,
                 state: state, redactedScreenshot: null };
      }

      var toolCall = llmResponse.toolCall;
      var toolName = toolCall.name || "unknown";

      // Append the model's tool-call turn to conversation history
      if (llmResponse.rawContent) messages.push(llmResponse.rawContent);

      // --- Step D: VALIDATE (security boundary) --------------------------------
      var validation = root.ToolValidator.validate(toolCall);
      if (!validation.valid) {
        var valErr = "Validation failed for '" + toolName + "': " + validation.error;
        root.AgentState.addError(valErr);

        // Tell the LLM so it can self-correct
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

      // --- Step E: Loop protection --------------------------------------------
      if (toolName === lastToolName) {
        toolRunCount[toolName] = (toolRunCount[toolName] || 0) + 1;
      } else {
        toolRunCount[toolName] = 1;
        lastToolName = toolName;
      }

      if (toolRunCount[toolName] > MAX_SAME_TOOL_IN_A_ROW) {
        var loopMsg = "Tool '" + toolName + "' called " +
          toolRunCount[toolName] + " consecutive times without progress. Stopping.";
        root.AgentState.addError(loopMsg);
        return { success: false, summary: loopMsg, state: state,
                 redactedScreenshot: state.redactedScreenshot || null };
      }

      // --- Step F: EXECUTE (trusted extension code) ---------------------------
      var toolResult;
      try {
        toolResult = await root.ToolExecutor.execute(
          toolName,
          toolCall.args || {},
          state,
          function (progressMsg) {
            // Forward progress updates to the UI
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

      // Track execution history
      state.executedTools.push({
        tool:      toolName,
        success:   toolResult.success,
        timestamp: Date.now(),
      });

      // Reset consecutive-call counter on success
      if (toolResult.success) toolRunCount[toolName] = 0;

      // --- Step G: Log for UI -------------------------------------------------
      var stepEntry = {
        step:     state.stepCount,
        tool:     toolName,
        status:   toolResult.success ? "success" : "error",
        message:  buildStepMessage(toolName, toolResult),
        duration: Date.now() - t0,
      };
      root.AgentState.addStepLog(
        stepEntry.step, stepEntry.tool, stepEntry.status,
        stepEntry.message, stepEntry.duration
      );
      notify(stepEntry);

      // --- Step H: Feed result back to LLM ------------------------------------
      var funcResp = root.AgentLLMClient.buildFunctionResponseMessage(toolName, toolResult);
      messages.push(funcResp);
    }

    // ---- Max-step guard ------------------------------------------------------
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
    };
  }

  // ---------------------------------------------------------------------------
  // Build a human-readable step message (NEVER includes raw PII)
  // ---------------------------------------------------------------------------
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
          (r.categorySummary ? " — " + summariseCats(r.categorySummary) : "") + ".";
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

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  root.AgentManager = {
    run:              run,
    MAX_AGENT_STEPS:  MAX_AGENT_STEPS,
  };
})(typeof window !== "undefined" ? window : self);
