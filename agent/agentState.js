// agent/agentState.js — Agent session state (runs in side panel)
//
// Short-term working memory for a single agent session.
//
// PRIVACY INVARIANT:
//   Only metadata (IDs, categories, confidence, source labels) lives here in
//   forms that travel to the LLM.  Raw screenshot pixels, DOM element handles,
//   and PII text values are stored as opaque blobs and NEVER sent to the LLM.

(function (root) {
  "use strict";

  var _state = null;

  // ---------------------------------------------------------------------------
  // State factory
  // ---------------------------------------------------------------------------
  function createState(userRequest) {
    return {
      sessionId: "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      userRequest: userRequest,

      currentPage: { url: "", title: "" },

      // Raw detections from each pipeline stage (stored locally)
      domDetections:  [],   // from contentScript / detector.js
      ocrDetections:  [],   // from OcrAnalyzer + PatternAnalyzer + ContextAnalyzer
      fusedDetections:[],   // from DetectionFusion

      // ID → detection map; LLM only sees the keys ("det_0", "det_1", …)
      detectionMap: {},

      // Screenshot state — NEVER forwarded to the LLM
      rawScreenshot:      null,
      redactedScreenshot: null,
      screenshotSize:     null,   // {width, height} in image pixels

      // Viewport from the content script
      viewport:     { width: 1280, height: 800 },
      uninspectable: [],
      ocrWordCount:  0,

      // Private tab handles used across tool calls
      _tabId:    null,
      _windowId: null,

      // Tracking
      redactedIds:    [],
      executedTools:  [],
      errors:         [],
      stepCount:      0,
      completed:      false,

      // For UI observability (step log shown to user)
      stepLog: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function init(userRequest) {
    _state = createState(userRequest);
    return _state;  // caller holds the same reference
  }

  function get()   { return _state; }
  function reset() { _state = null; }

  // ---------------------------------------------------------------------------
  // Detection ID management
  // ---------------------------------------------------------------------------

  /**
   * Assign stable "det_N" IDs and build the detection map from a fused list.
   * Called by the fuse_detections tool after DetectionFusion.fuse() completes.
   */
  function assignDetectionIds(detections) {
    if (!_state) return;
    _state.fusedDetections = detections;
    _state.detectionMap = {};
    for (var i = 0; i < detections.length; i++) {
      _state.detectionMap["det_" + i] = detections[i];
    }
  }

  /**
   * Return detection metadata that is safe to send to the LLM.
   * Contains: id, category, confidence (numeric), sources array.
   * Does NOT contain: rect, element handles, raw text, matched values.
   */
  function getDetectionMetadata() {
    if (!_state) return [];
    return Object.keys(_state.detectionMap).map(function (id) {
      var det = _state.detectionMap[id];
      return {
        id:         id,
        category:   det.category,
        confidence: typeof det.confidence === "number"
          ? Math.round(det.confidence * 100) / 100
          : det.confidence,
        sources:    det.sources || ["dom"],
      };
    });
  }

  /**
   * Resolve a list of "det_N" IDs to their detection objects.
   * Used by the redact tool; returns found + notFound arrays.
   */
  function resolveDetectionIds(ids) {
    if (!_state) return { found: [], notFound: [] };
    var found    = [];
    var notFound = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (_state.detectionMap[id]) {
        found.push({ id: id, detection: _state.detectionMap[id] });
      } else {
        notFound.push(id);
      }
    }
    return { found: found, notFound: notFound };
  }

  // ---------------------------------------------------------------------------
  // Logging helpers
  // ---------------------------------------------------------------------------

  function addStepLog(step, tool, status, message, duration) {
    if (!_state) return;
    _state.stepLog.push({
      step:      step,
      tool:      tool,
      status:    status,   // "success" | "error" | "working" | "rejected" | "complete"
      message:   message,
      duration:  duration || 0,
      timestamp: Date.now(),
    });
  }

  function addError(error) {
    if (!_state) return;
    _state.errors.push({
      step:      _state.stepCount,
      error:     String(error),
      timestamp: Date.now(),
    });
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  root.AgentState = {
    init:                  init,
    get:                   get,
    reset:                 reset,
    assignDetectionIds:    assignDetectionIds,
    getDetectionMetadata:  getDetectionMetadata,
    resolveDetectionIds:   resolveDetectionIds,
    addStepLog:            addStepLog,
    addError:              addError,
  };
})(typeof window !== "undefined" ? window : self);
