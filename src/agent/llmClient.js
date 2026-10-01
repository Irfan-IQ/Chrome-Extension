// agent/llmClient.js — Gemini API client with native function calling
//
// PRIVACY DESIGN:
//   • Tool result contents are sanitized before being included in the conversation:
//     fields that could carry raw PII values are stripped.
//   • The LLM only sees detection IDs, categories, confidence scores, and count summaries.
//   • A strong system instruction defines the LLM's role and constraints.

// Model id must match a model served by Generative Language v1beta.
// Keep in sync with src/gemini.js (GEMINI_MODEL) and server/config.py.
var AGENT_MODEL = "gemini-2.0-flash";
var GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

import { Gemini } from '../gemini.js';

// System prompt lives in its own .md file so it can be reviewed and A/B'd
// without touching JS. Vite's `?raw` suffix inlines the file as a plain
// string at build time.
import SYSTEM_PROMPT_TEXT from './systemPrompt.md?raw';

var SYSTEM_INSTRUCTION = {
  parts: [{ text: SYSTEM_PROMPT_TEXT }],
};

async function generateWithTools(messages, toolDefinitions, apiKey) {
  var mode = "direct";
  var serverUrl = "http://127.0.0.1:8000";
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      var stored = await chrome.storage.local.get(["backendMode", "serverUrl"]);
      if (stored.backendMode) mode = stored.backendMode;
      if (stored.serverUrl) serverUrl = stored.serverUrl;
    }
  } catch (e) {}

  if (mode === "server") {
    return await generateWithServer(messages, toolDefinitions, serverUrl);
  }

  if (!apiKey) throw new Error("No Gemini API key configured.");

  var endpoint = GEMINI_BASE + AGENT_MODEL + ":generateContent";

  var body = {
    system_instruction: SYSTEM_INSTRUCTION,
    contents: messages,
    tools: [{ functionDeclarations: toolDefinitions }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  };

  var response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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
    if (response.status === 429) throw new Error("Rate limit hit. Please wait a moment.");
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
  if (!candidate) throw new Error("Gemini returned no candidates.");
  if (candidate.finishReason === "SAFETY") throw new Error("Response stopped by safety filters.");

  var parts = (candidate.content && candidate.content.parts) || [];

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

  var text = parts.map(function (p) { return (p && p.text) ? p.text : ""; }).join("").trim();
  if (!text) throw new Error("Gemini returned an empty response.");

  return { type: "text", text: text, rawContent: candidate.content };
}

function buildFunctionResponseMessage(toolName, toolResult) {
  var safeResult = sanitizeForLLM(toolResult);
  safeResult = clampPayload(safeResult);
  return {
    role: "user",
    parts: [{ functionResponse: { name: toolName, response: safeResult } }],
  };
}

var STRIP_FIELDS = [
  "matchedText", "rawText", "value", "text", "ocrText",
  "evidence",
  "_el", "_cssPxRect", "_words", "_lines",
  "selector",
];

// Hard upper bound on a single tool-result payload after stripping, in bytes
// of serialized JSON. Oversized results (e.g. OCR with thousands of words,
// or a huge DOM scan) are truncated before being handed to the LLM so a
// single step cannot blow out the context window or run up API cost.
var MAX_RESULT_JSON_BYTES = 16 * 1024;
// Arrays longer than this (detection lists, step logs, etc.) are capped and
// a `truncated` note is appended. Agents only need stable IDs + counts, not
// every row.
var MAX_ARRAY_ITEMS = 64;

function sanitizeForLLM(obj) {
  if (!obj || typeof obj !== "object") return obj;
  try {
    var clone = JSON.parse(JSON.stringify(obj));
    stripFields(clone);
    return clone;
  } catch (e) {
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

function byteSize(obj) {
  try { return JSON.stringify(obj).length; } catch (e) { return Infinity; }
}

function capArrays(obj) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    if (obj.length > MAX_ARRAY_ITEMS) {
      var dropped = obj.length - MAX_ARRAY_ITEMS;
      obj.length = MAX_ARRAY_ITEMS;
      obj.push({ _truncated: dropped + " more item(s) dropped to fit payload cap." });
    }
    for (var i = 0; i < obj.length; i++) capArrays(obj[i]);
    return;
  }
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) capArrays(obj[k]);
  }
}

function clampPayload(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (byteSize(obj) <= MAX_RESULT_JSON_BYTES) return obj;

  capArrays(obj);
  if (byteSize(obj) <= MAX_RESULT_JSON_BYTES) return obj;

  // Last resort: keep only the structural header so the agent still knows
  // the tool ran and whether it succeeded.
  return {
    success: !!obj.success,
    tool:    obj.tool,
    error:   obj.error || null,
    note:    "Payload exceeded " + MAX_RESULT_JSON_BYTES +
             " bytes after stripping and truncation; detail omitted.",
  };
}

async function generateWithServer(messages, toolDefinitions, serverUrl) {
  var endpoint = (serverUrl || "http://127.0.0.1:8000").replace(/\/+$/, "") + "/v1/chat/completions";

  var tools = (toolDefinitions || []).map(function (tool) {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || { type: "object", properties: {} },
      },
    };
  });

  var openaiMessages = [];
  if (SYSTEM_INSTRUCTION && SYSTEM_INSTRUCTION.parts && SYSTEM_INSTRUCTION.parts[0]) {
    openaiMessages.push({
      role: "system",
      content: SYSTEM_INSTRUCTION.parts[0].text,
    });
  }

  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (!m || !m.parts) continue;

    for (var j = 0; j < m.parts.length; j++) {
      var part = m.parts[j];
      if (!part) continue;

      if (part.functionResponse) {
        var respStr = "{}";
        try {
          respStr = typeof part.functionResponse.response === "string"
            ? part.functionResponse.response
            : JSON.stringify(part.functionResponse.response || {});
        } catch (e) {}
        openaiMessages.push({
          role: "tool",
          name: part.functionResponse.name,
          content: respStr,
        });
      } else if (part.functionCall) {
        openaiMessages.push({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_" + Math.random().toString(36).slice(2, 9),
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {}),
            },
          }],
        });
      } else if (part.text) {
        openaiMessages.push({
          role: m.role === "model" ? "assistant" : "user",
          content: part.text,
        });
      }
    }
  }

  var body = {
    messages: openaiMessages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: "auto",
    temperature: 0.1,
    max_tokens: 2048,
  };

  var response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: await Gemini.buildServerHeaders(),
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    throw new Error("Could not reach local server at " + serverUrl + ". Is it running?");
  }

  if (!response.ok) {
    var errDetail = "Server error (" + response.status + ")";
    try {
      var errJson = await response.json();
      if (errJson && errJson.detail) errDetail = errJson.detail;
    } catch (_) {}
    throw new Error(errDetail);
  }

  var data;
  try { data = await response.json(); }
  catch (_) { throw new Error("Invalid JSON returned from server."); }

  var candidate = data.choices && data.choices[0];
  if (!candidate || !candidate.message) {
    throw new Error("Server returned an empty response.");
  }

  var msg = candidate.message;

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    var tc = msg.tool_calls[0];
    var fnName = (tc.function && tc.function.name) || "";
    var rawArgs = (tc.function && tc.function.arguments) || "{}";
    var parsedArgs = {};
    if (typeof rawArgs === "object" && rawArgs !== null) {
      parsedArgs = rawArgs;
    } else if (typeof rawArgs === "string") {
      try { parsedArgs = JSON.parse(rawArgs); }
      catch (_) { parsedArgs = {}; }
    }

    return {
      type: "tool_call",
      toolCall: { name: fnName, args: parsedArgs },
      rawContent: {
        role: "model",
        parts: [{ functionCall: { name: fnName, args: parsedArgs } }],
      },
    };
  }

  var text = msg.content || "";
  if (!text) throw new Error("Server returned an empty response.");

  return {
    type: "text",
    text: text,
    rawContent: { role: "model", parts: [{ text: text }] },
  };
}

export const AgentLLMClient = {
  generateWithTools,
  generateWithServer,
  buildFunctionResponseMessage,
  AGENT_MODEL,
};
