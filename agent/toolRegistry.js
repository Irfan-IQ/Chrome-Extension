// agent/toolRegistry.js — Tool definitions for Gemini function calling
//
// This is the COMPLETE and ONLY list of operations the LLM may request.
// Arbitrary JavaScript, eval(), executeScript with LLM-generated code,
// shell commands, and filesystem access are NOT present and CANNOT be added
// by the LLM through this registry.
//
// Security model: the LLM is shown these definitions and may only call tools
// by name. Every call is re-validated by toolValidator.js before execution.

(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Allowlists
  // ---------------------------------------------------------------------------

  var ALLOWED_TOOLS = [
    "scan_dom",
    "take_screenshot",
    "scan_ocr",
    "fuse_detections",
    "redact",
    "verify_redaction",
    "get_page_context",
    // Browser action tools
    "click_element",
    "navigate_to",
    "open_tab",
  ];

  var ALLOWED_METHODS = ["MASK", "BLACK_BOX", "TOKENIZE"];

  // ---------------------------------------------------------------------------
  // Gemini functionDeclarations schema
  // ---------------------------------------------------------------------------

  var TOOL_DEFINITIONS = [
    {
      name: "scan_dom",
      description:
        "Analyze the current webpage DOM for personally identifiable information (PII). " +
        "Uses deterministic local rules — no data leaves the browser. " +
        "Detects form fields (input, textarea, select) and static display text containing " +
        "emails, phone numbers, names, addresses, IDs, card numbers, etc. " +
        "Returns detection counts and category metadata only — never raw field values. " +
        "Always call this as the first step before any redaction.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "take_screenshot",
      description:
        "Capture the current visible state of the active browser tab as a screenshot. " +
        "The screenshot is stored locally in the extension — never sent to any external service. " +
        "Required before running scan_ocr. " +
        "Returns only the screenshot dimensions and a status note.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "scan_ocr",
      description:
        "Analyze the visible page content using local OCR (Tesseract.js — runs entirely in the browser) " +
        "to detect PII appearing in images, canvas elements, or rendered text that is not in the DOM. " +
        "Automatically captures a screenshot first if one is not already available. " +
        "Returns detection counts and category metadata — never raw OCR text or PII values.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "fuse_detections",
      description:
        "Merge and deduplicate results from scan_dom and scan_ocr into a single unified list. " +
        "Computes a confidence score for each detection based on how many independent sources agreed. " +
        "Assigns stable detection IDs (det_0, det_1, …) that can be passed to the redact tool. " +
        "Always call this after scanning before redacting.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "redact",
      description:
        "Redact specified PII regions by painting opaque blocks over them in the page screenshot. " +
        "detectionIds must be IDs returned by fuse_detections (e.g. [\"det_0\", \"det_1\"]). " +
        "Always call fuse_detections before calling redact.",
      parameters: {
        type: "object",
        properties: {
          detectionIds: {
            type: "array",
            description:
              "List of detection IDs to redact. " +
              "These must be IDs that appeared in the fuse_detections result.",
            items: { type: "string" },
          },
          method: {
            type: "string",
            description:
              "Redaction method: " +
              "MASK = opaque block with a category label (recommended), " +
              "BLACK_BOX = plain solid black block, " +
              "TOKENIZE = category placeholder text only.",
            enum: ["MASK", "BLACK_BOX", "TOKENIZE"],
          },
        },
        required: ["detectionIds", "method"],
      },
    },
    {
      name: "verify_redaction",
      description:
        "Verify that every detected PII region has been covered by a redaction. " +
        "Returns the total detection count, the number redacted, and any remaining unmasked IDs. " +
        "If any remain, call redact() again with the remaining IDs. " +
        "Always call this after redact() to confirm the task is complete.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_page_context",
      description:
        "Get basic contextual information about the current page: hostname, document title, " +
        "and viewport dimensions. Does not return any page content or sensitive data.",
      parameters: {
        type: "object",
        properties: {},
      },
    },

    // -------------------------------------------------------------------------
    // Browser action tools
    // -------------------------------------------------------------------------
    {
      name: "click_element",
      description:
        "Click a visible element on the current page. " +
        "Use 'text' to find an element by its visible label (e.g. 'Repositories', 'Sign in'). " +
        "Use 'selector' for a precise CSS selector (e.g. 'a[href*=\"repositories\"]'). " +
        "At least one of 'selector' or 'text' must be provided. " +
        "Prefer 'text' for navigation links, tabs, and buttons the user can see. " +
        "Returns the tag and label of the element that was clicked.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type:        "string",
            description: "CSS selector for the element to click (optional if 'text' is given).",
          },
          text: {
            type:        "string",
            description: "Visible text label of the element to click (case-insensitive match).",
          },
        },
      },
    },

    {
      name: "navigate_to",
      description:
        "Navigate the active browser tab to a URL. " +
        "Only http:// and https:// URLs are accepted. " +
        "Use this when you know the exact destination URL " +
        "(e.g. 'https://github.com/Irfan-IQ?tab=repositories').",
      parameters: {
        type: "object",
        properties: {
          url: {
            type:        "string",
            description: "Full URL to navigate to. Must start with http:// or https://.",
          },
        },
        required: ["url"],
      },
    },

    {
      name: "open_tab",
      description:
        "Find an existing browser tab by searching its title or URL, then switch to it. " +
        "If no match is found and a 'url' is provided, opens a new tab at that URL. " +
        "Use 'query' to search by title or URL fragment (e.g. 'GitHub', 'repositories'). " +
        "Set 'new_tab' to true to always open a new tab (requires 'url').",
      parameters: {
        type: "object",
        properties: {
          query: {
            type:        "string",
            description: "Search string matched against tab title and URL (case-insensitive).",
          },
          url: {
            type:        "string",
            description: "Fallback URL to open if no existing tab matches (http/https only).",
          },
          new_tab: {
            type:        "boolean",
            description: "If true, always open a new tab at 'url' instead of searching.",
          },
        },
      },
    },
  ];

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  function getDefinitions()        { return TOOL_DEFINITIONS; }
  function getAllowedNames()        { return ALLOWED_TOOLS.slice(); }
  function getAllowedMethods()      { return ALLOWED_METHODS.slice(); }

  function getByName(name) {
    for (var i = 0; i < TOOL_DEFINITIONS.length; i++) {
      if (TOOL_DEFINITIONS[i].name === name) return TOOL_DEFINITIONS[i];
    }
    return null;
  }

  root.ToolRegistry = {
    getDefinitions:   getDefinitions,
    getAllowedNames:   getAllowedNames,
    getAllowedMethods: getAllowedMethods,
    getByName:        getByName,
    ALLOWED_TOOLS:    ALLOWED_TOOLS,
    ALLOWED_METHODS:  ALLOWED_METHODS,
  };
})(typeof window !== "undefined" ? window : self);
