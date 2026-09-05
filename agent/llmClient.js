// agent/llmClient.js — Gemini API client with native function calling
//
// Uses Gemini's structured function-calling API so the LLM emits typed tool
// calls rather than free-form text that would have to be parsed.
//
// PRIVACY DESIGN:
//   • Tool result contents are sanitized before being included in the
//     conversation: fields that could carry raw PII values are stripped.
//   • The LLM only sees detection IDs, categories, confidence scores, and
//     count summaries — never raw page text, screenshot pixels, or PII values.
//   • A strong system instruction defines the LLM's role and constraints.

(function (root) {
  "use strict";

  // Use gemini-3.6-flash as recommended by Google's API.
  var AGENT_MODEL   = "gemini-3.6-flash";
  var GEMINI_BASE   = "https://generativelanguage.googleapis.com/v1beta/models/";

  // ---------------------------------------------------------------------------
  // System instruction — defines agent role and hard constraints
  // ---------------------------------------------------------------------------
  var SYSTEM_INSTRUCTION = {
    parts: [{
      text: [
        "You are the planning and reasoning component of a Chrome extension called Redact Agent.",
        "",
        "YOUR ROLE:",
        "- Understand the user's request — it may be a privacy/PII task OR a browser action task.",
        "- Decide which tool to call next based on the current state and previous tool results.",
        "- Interpret tool results and plan the next step.",
        "- Stop and summarise concisely when the task is fully and verifiably complete.",
        "",
        "ABSOLUTE CONSTRAINTS:",
        "- You may ONLY interact with the browser through the provided tools.",
        "- You MUST NOT generate JavaScript, code, or executable content of any kind.",
        "- You MUST NOT request tools that are not in the provided function list.",
        "- You MUST NOT claim success unless a tool returned success: true.",
        "- You MUST NOT repeat or expose raw PII values in your responses.",
        "",
        "== TASK TYPE A: BROWSER ACTIONS ==",
        "Use these tools when the user asks to navigate, click, or switch tabs:",
        "",
        "  click_element(text, selector)",
        "    — Click a visible element. Use 'text' for labels like 'Repositories', 'Sign in'.",
        "    — Use 'selector' for precise CSS e.g. 'a[href*=\"repositories\"]'.",
        "    — Prefer 'text' for human-readable labels.",
        "",
        "  navigate_to(url)",
        "    — Navigate the active tab to an exact http/https URL.",
        "    — Use when you know the full URL (e.g. from get_page_context result).",
        "",
        "  open_tab(query, url, new_tab)",
        "    — Search existing tabs by title/URL and switch to the match.",
        "    — Opens a new tab at 'url' if no match is found.",
        "    — Set new_tab: true to always open fresh.",
        "",
        "  get_page_context()",
        "    — Get the current page's hostname, title, and viewport size.",
        "    — Call this first when you need the page URL to construct a navigate_to call.",
        "",
        "BROWSER TASK WORKFLOW EXAMPLE — 'open the Repositories tab':",
        "  1. click_element(text: 'Repositories')",
        "  → If NOT_FOUND: get_page_context() to get the hostname, then",
        "  2. navigate_to(url: 'https://<host>?tab=repositories')",
        "",
        "== TASK TYPE B: PRIVACY / PII REDACTION ==",
        "Use these tools for scanning and redacting sensitive data on the page:",
        "",
        "  TYPICAL WORKFLOW for 'redact all PII':",
        "  1. scan_dom        — detect PII in DOM fields and text nodes.",
        "  2. take_screenshot — capture the page.",
        "  3. scan_ocr        — detect PII in images/canvas via local OCR.",
        "  4. fuse_detections — merge and assign detection IDs.",
        "  5. redact          — mask all detected regions (pass all IDs from step 4).",
        "  6. verify_redaction — confirm 0 regions remain unmasked.",
        "",
        "PRIVACY RULES:",
        "- The extension handles all sensitive data locally — OCR, DOM scanning, screenshot masking.",
        "- You only receive anonymised metadata: detection IDs, categories, confidence scores.",
        "- Raw PII values and pixel data are never sent to you.",
        "",
        "FAILURE HANDLING:",
        "- If scan_ocr fails, skip it and run fuse_detections on DOM results alone.",
        "- If a tool fails with an unrecoverable error, stop and explain clearly.",
        "- Do not retry the same tool more than once without a different approach.",
        "",
        "FINAL RESPONSE:",
        "Write a short, user-facing summary of what was done.",
        "For PII tasks: include count and categories (e.g. '3 emails, 2 phone numbers redacted').",
        "For browser tasks: confirm what was clicked/navigated/opened.",
        "Never include raw values, internal IDs, or technical details in the summary.",
      ].join("\n"),
    }],
  };

  // ---------------------------------------------------------------------------
  // Primary API — generate with tool calling
  // ---------------------------------------------------------------------------

  /**
   * Call Gemini with function-calling enabled.
   *
   * @param {Array}  messages       - Conversation so far (Gemini contents format)
   * @param {Array}  toolDefinitions- functionDeclarations from toolRegistry
   * @param {string} apiKey         - Gemini API key
   * @returns {Promise<{type:"tool_call"|"text", toolCall?:object, text?:string, rawContent:object}>}
   */
  async function generateWithTools(messages, toolDefinitions, apiKey) {
    if (!apiKey) throw new Error("No Gemini API key configured.");

    var endpoint = GEMINI_BASE + AGENT_MODEL + ":generateContent";

    var body = {
      system_instruction: SYSTEM_INSTRUCTION,
      contents: messages,
      tools: [{ functionDeclarations: toolDefinitions }],
      toolConfig: {
        functionCallingConfig: { mode: "AUTO" },
      },
      generationConfig: {
        temperature:     0.1,    // low temperature → more deterministic tool selection
        maxOutputTokens: 2048,
      },
    };

    var response;
    try {
      response = await fetch(endpoint, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      throw new Error("Network error reaching Gemini: " + ((networkErr && networkErr.message) || "unknown"));
    }

    var data;
    try { data = await response.json(); }
    catch (e) { throw new Error("Gemini returned invalid JSON."); }

    if (!response.ok) {
      var apiMsg = (data && data.error && data.error.message) || "Unknown API error";
      if (response.status === 429)             throw new Error("Rate limit hit. Please wait a moment.");
      if (response.status === 401 || response.status === 403)
                                               throw new Error("API key rejected by Gemini.");
      if (response.status === 400 && /api.?key/i.test(apiMsg))
                                               throw new Error("Your Gemini API key appears invalid.");
      throw new Error("Gemini API error (" + response.status + "): " + apiMsg);
    }

    if (data.promptFeedback && data.promptFeedback.blockReason) {
      throw new Error("Request blocked by Gemini safety filters: " + data.promptFeedback.blockReason);
    }

    var candidate = data.candidates && data.candidates[0];
    if (!candidate)        throw new Error("Gemini returned no candidates.");
    if (candidate.finishReason === "SAFETY") throw new Error("Response stopped by safety filters.");

    var parts = (candidate.content && candidate.content.parts) || [];

    // Check for a function call in any part
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part && part.functionCall) {
        return {
          type: "tool_call",
          toolCall: {
            name: part.functionCall.name,
            args: part.functionCall.args || {},
          },
          rawContent: candidate.content,
        };
      }
    }

    // Otherwise it's a final text answer
    var text = parts.map(function (p) { return (p && p.text) ? p.text : ""; }).join("").trim();
    if (!text) throw new Error("Gemini returned an empty response.");

    return {
      type:       "text",
      text:       text,
      rawContent: candidate.content,
    };
  }

  // ---------------------------------------------------------------------------
  // Build a function-response message to add to the conversation
  // ---------------------------------------------------------------------------

  /**
   * Wrap a tool result in Gemini's function-response format.
   * The result is sanitized first to ensure no raw PII escapes to the LLM.
   */
  function buildFunctionResponseMessage(toolName, toolResult) {
    var safeResult = sanitizeForLLM(toolResult);
    return {
      role: "user",
      parts: [{
        functionResponse: {
          name:     toolName,
          response: safeResult,
        },
      }],
    };
  }

  // ---------------------------------------------------------------------------
  // Sanitize tool results — strip any field that might carry raw PII
  // ---------------------------------------------------------------------------

  // Fields that could contain actual sensitive text or binary data
  var STRIP_FIELDS = [
    "matchedText", "rawText", "value", "text", "ocrText",
    "evidence",    // might contain label fragments
    "_el", "_cssPxRect", "_words", "_lines",  // internal handles
    "selector",    // CSS selectors could expose structure but are not PII; kept
                   // commented out — uncomment if stricter is needed
  ];

  function sanitizeForLLM(obj) {
    if (!obj || typeof obj !== "object") return obj;
    try {
      var clone = JSON.parse(JSON.stringify(obj));
      stripFields(clone);
      return clone;
    } catch (e) {
      // If serialization fails (e.g. circular reference), return a safe fallback
      return { success: obj.success, tool: obj.tool, note: "Result not serializable." };
    }
  }

  function stripFields(obj) {
    if (typeof obj !== "object" || obj === null) return;
    if (Array.isArray(obj)) {
      obj.forEach(function (item) { stripFields(item); });
      return;
    }
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      if (STRIP_FIELDS.indexOf(key) !== -1) {
        delete obj[key];
      } else {
        stripFields(obj[key]);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  root.AgentLLMClient = {
    generateWithTools:          generateWithTools,
    buildFunctionResponseMessage: buildFunctionResponseMessage,
    AGENT_MODEL:                AGENT_MODEL,
  };
})(typeof window !== "undefined" ? window : self);
