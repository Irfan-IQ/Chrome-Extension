// agent/agentState.js — Agent session state (runs in side panel)
//
// Short-term working memory for a single agent session.
//
// PRIVACY INVARIANT:
//   Only metadata (IDs, categories, confidence, source labels) lives here in
//   forms that travel to the LLM. Raw screenshot pixels, DOM element handles,
//   and PII text values are stored as opaque blobs and NEVER sent to the LLM.

var _state = null;

function createState(userRequest) {
  return {
    sessionId: "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    userRequest: userRequest,

    currentPage: { url: "", title: "" },

    domDetections:  [],
    ocrDetections:  [],
    visionDetections:[],
    fusedDetections:[],

    detectionMap: {},

    rawScreenshot:      null,
    redactedScreenshot: null,
    screenshotSize:     null,

    viewport:     { width: 1280, height: 800 },
    uninspectable: [],
    ocrWordCount:  0,

    _tabId:    null,
    _windowId: null,

    redactedIds:    [],
    executedTools:  [],
    errors:         [],
    stepCount:      0,
    completed:      false,

    screenshotLog: [],

    stepLog: [],
  };
}

function init(userRequest) {
  _state = createState(userRequest);
  return _state;
}

function get()   { return _state; }
function reset() { _state = null; }

function assignDetectionIds(detections) {
  if (!_state) return;
  _state.fusedDetections = detections;
  _state.detectionMap = {};
  for (var i = 0; i < detections.length; i++) {
    _state.detectionMap["det_" + i] = detections[i];
  }
}

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

function addStepLog(step, tool, status, message, duration) {
  if (!_state) return;
  _state.stepLog.push({
    step:      step,
    tool:      tool,
    status:    status,
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

export const AgentState = {
  init,
  get,
  reset,
  assignDetectionIds,
  getDetectionMetadata,
  resolveDetectionIds,
  addStepLog,
  addError,
};
