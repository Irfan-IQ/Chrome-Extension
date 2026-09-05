// agent/toolValidator.js — Security boundary between LLM output and execution
//
// EVERY tool call from the LLM passes through this validator before anything runs.
// The LLM is treated as UNTRUSTED INPUT — even if the LLM appears to request
// a legitimate tool, it must pass all checks here before execution proceeds.
//
// Rejects:
//   • Unknown tool names (not in ToolRegistry allowlist)
//   • Arguments of the wrong type
//   • Detection IDs that don't match the expected det_N pattern
//   • Redaction methods not in the allowlist
//   • Missing required parameters
//   • Any argument that could be an injection vector

(function (root) {
  "use strict";

  /**
   * Validate a tool call object produced by the LLM.
   *
   * @param {{ name: string, args: object }} toolCall
   * @returns {{ valid: boolean, error?: string }}
   */
  function validate(toolCall) {
    if (!toolCall || typeof toolCall !== "object") {
      return { valid: false, error: "Tool call must be an object." };
    }

    var name = toolCall.name;
    var args = toolCall.args;

    // --- Tool name -----------------------------------------------------------
    if (typeof name !== "string" || !name.trim()) {
      return { valid: false, error: "Tool name is missing or not a string." };
    }

    var allowed = root.ToolRegistry ? root.ToolRegistry.getAllowedNames() : [];
    if (allowed.indexOf(name) === -1) {
      return {
        valid: false,
        error:
          "Unknown tool: '" +
          String(name).slice(0, 40) +
          "'. Allowed tools: " +
          allowed.join(", ") +
          ".",
      };
    }

    // --- Args ----------------------------------------------------------------
    // Must be an object (or absent — treated as {})
    if (args !== undefined && args !== null && typeof args !== "object") {
      return { valid: false, error: "Tool arguments must be an object." };
    }

    var safeArgs = args && typeof args === "object" ? args : {};

    // --- Per-tool parameter checks -------------------------------------------
    var paramError = validateParams(name, safeArgs);
    if (paramError) {
      return { valid: false, error: paramError };
    }

    return { valid: true };
  }

  // ---------------------------------------------------------------------------
  // Per-tool parameter validators
  // ---------------------------------------------------------------------------

  function validateParams(name, args) {
    switch (name) {
      // No-parameter tools — any extra fields are silently ignored
      case "scan_dom":
      case "take_screenshot":
      case "scan_ocr":
      case "fuse_detections":
      case "verify_redaction":
      case "get_page_context":
        return null;

      case "redact":
        return validateRedactParams(args);

      case "click_element":
        return validateClickElementParams(args);

      case "navigate_to":
        return validateNavigateToParams(args);

      case "open_tab":
        return validateOpenTabParams(args);

      default:
        return "No parameter validator for tool: " + name;
    }
  }

  function validateRedactParams(args) {
    // detectionIds ----
    var ids = args.detectionIds;
    if (!Array.isArray(ids)) {
      return "redact: 'detectionIds' must be an array of strings.";
    }
    if (ids.length === 0) {
      return "redact: 'detectionIds' must not be empty.";
    }
    if (ids.length > 500) {
      return "redact: 'detectionIds' exceeds the maximum of 500 entries.";
    }
    for (var i = 0; i < ids.length; i++) {
      if (typeof ids[i] !== "string") {
        return "redact: every detection ID must be a string, got " + typeof ids[i];
      }
      // IDs must match exactly: det_<non-negative integer>
      if (!/^det_\d+$/.test(ids[i])) {
        return (
          "redact: invalid detection ID format '" +
          String(ids[i]).slice(0, 20) +
          "'. Expected pattern: det_N where N is a non-negative integer."
        );
      }
    }

    // method ----
    var method = args.method;
    if (typeof method !== "string") {
      return "redact: 'method' must be a string.";
    }
    var allowedMethods = root.ToolRegistry ? root.ToolRegistry.getAllowedMethods() : [];
    if (allowedMethods.indexOf(method) === -1) {
      return (
        "redact: invalid method '" +
        String(method).slice(0, 20) +
        "'. Allowed values: " +
        allowedMethods.join(", ") +
        "."
      );
    }

    return null; // valid
  }

  // ---------------------------------------------------------------------------
  // Browser action validators
  // ---------------------------------------------------------------------------

  function validateClickElementParams(args) {
    var selector = args.selector;
    var text     = args.text;

    if (selector === undefined && text === undefined) {
      return "click_element: at least one of 'selector' or 'text' must be provided.";
    }
    if (selector !== undefined) {
      if (typeof selector !== "string") return "click_element: 'selector' must be a string.";
      if (selector.trim().length === 0)  return "click_element: 'selector' must not be empty.";
      if (selector.length > 500)         return "click_element: 'selector' exceeds 500 characters.";
    }
    if (text !== undefined) {
      if (typeof text !== "string") return "click_element: 'text' must be a string.";
      if (text.trim().length === 0)  return "click_element: 'text' must not be empty.";
      if (text.length > 200)         return "click_element: 'text' exceeds 200 characters.";
    }
    return null;
  }

  function validateNavigateToParams(args) {
    var url = args.url;
    if (typeof url !== "string" || !url.trim()) {
      return "navigate_to: 'url' is required and must be a non-empty string.";
    }
    if (!/^https?:\/\//i.test(url.trim())) {
      return "navigate_to: only http:// and https:// URLs are allowed.";
    }
    if (url.length > 2000) {
      return "navigate_to: URL exceeds 2000 characters.";
    }
    return null;
  }

  function validateOpenTabParams(args) {
    var query  = args.query;
    var url    = args.url;
    var newTab = args.new_tab;

    if (query === undefined && url === undefined) {
      return "open_tab: at least one of 'query' or 'url' must be provided.";
    }
    if (query !== undefined) {
      if (typeof query !== "string") return "open_tab: 'query' must be a string.";
      if (query.trim().length === 0)  return "open_tab: 'query' must not be empty.";
      if (query.length > 200)         return "open_tab: 'query' exceeds 200 characters.";
    }
    if (url !== undefined) {
      if (typeof url !== "string") return "open_tab: 'url' must be a string.";
      if (!/^https?:\/\//i.test(url.trim())) return "open_tab: only http/https URLs are allowed.";
      if (url.length > 2000) return "open_tab: URL exceeds 2000 characters.";
    }
    if (newTab !== undefined && typeof newTab !== "boolean") {
      return "open_tab: 'new_tab' must be a boolean.";
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  root.ToolValidator = {
    validate: validate,
  };
})(typeof window !== "undefined" ? window : self);
