// sidepanel.js — UI logic only. Gemini communication lives in gemini.js.
// V4: Extended with Agent mode (LLM-driven tool-calling agent).

const STORAGE_KEY_HISTORY = "chatHistory";
const STORAGE_KEY_PRIVACY  = "privacyEnabled"; // V2/V3/V4: default ON

let history  = [];
let isSending = false;
let isAgentRunning = false;
let currentMode = "chat"; // "chat" | "agent"

// ---------- Element refs ----------
const chatEl         = document.getElementById("chat");
const inputEl        = document.getElementById("input");
const sendBtn        = document.getElementById("send-btn");
const clearBtn       = document.getElementById("clear-btn");
const settingsBtn    = document.getElementById("settings-btn");
const settingsPanel  = document.getElementById("settings-panel");
const apiKeyInput    = document.getElementById("api-key-input");
const saveKeyBtn     = document.getElementById("save-key-btn");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const settingsStatus = document.getElementById("settings-status");
const statusDot      = document.getElementById("status-dot");

// ---------- Privacy element refs ----------
const privacyEnabledEl = document.getElementById("privacy-enabled");
const privacyStateEl   = document.getElementById("privacy-state");
const privacyStatusEl  = document.getElementById("privacy-status");
const privacyDetailEl  = document.getElementById("privacy-detail");
const privacyInfoBtn   = document.getElementById("privacy-info-btn");

// ---------- V3 debug panel refs ----------
const debugBtn       = document.getElementById("debug-btn");
const debugPanel     = document.getElementById("debug-panel");
const debugCloseBtn  = document.getElementById("debug-close-btn");
const debugListEl    = document.getElementById("debug-list");

// ---------- V3 Scan button + result panel refs ----------
const scanBtn             = document.getElementById("scan-btn");
const scanResultPanel     = document.getElementById("scan-result-panel");
const cardDomEl           = document.getElementById("card-dom");
const cardOcrEl           = document.getElementById("card-ocr");
const cardFusedEl         = document.getElementById("card-fused");
const guaranteeOcrEl      = document.getElementById("guarantee-ocr");
const scanCategoriesEl    = document.getElementById("scan-categories");
const tabOriginalBtn      = document.getElementById("tab-original");
const tabSanitizedBtn     = document.getElementById("tab-sanitized");
const shotOriginalEl      = document.getElementById("shot-original");
const shotSanitizedEl     = document.getElementById("shot-sanitized");
const imgOriginalEl       = document.getElementById("img-original");
const imgSanitizedEl      = document.getElementById("img-sanitized");
const scanResultCloseBtn  = document.getElementById("scan-result-close-btn");

// ---------- Zoom lightbox refs ----------
const zoomOverlay = document.getElementById("zoom-overlay");
const zoomImg     = document.getElementById("zoom-img");
const zoomCloseBtn= document.getElementById("zoom-close");

// ---------- V4 Agent mode element refs ----------
const modeChatBtn       = document.getElementById("mode-chat-btn");
const modeAgentBtn      = document.getElementById("mode-agent-btn");
const chatModePanel     = document.getElementById("chat-mode-panel");
const agentModePanel    = document.getElementById("agent-mode-panel");
const agentInputEl      = document.getElementById("agent-input");
const agentRunBtn       = document.getElementById("agent-run-btn");
const agentLogPanel     = document.getElementById("agent-log-panel");
const agentLogStatus    = document.getElementById("agent-log-status");
const agentStepList     = document.getElementById("agent-step-list");
const agentResultPanel  = document.getElementById("agent-result-panel");
const agentResultClose  = document.getElementById("agent-result-close-btn");
const agentResultText   = document.getElementById("agent-result-text");
const agentScreenshotSection = document.getElementById("agent-screenshot-section");
const agentResultImg    = document.getElementById("agent-result-img");

// ---------- Rendering ----------

function renderEmptyState() {
  chatEl.innerHTML =
    '<div class="empty-state">Ask the assistant anything to get started.</div>';
}

function renderMessage(role, content, kind) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + kind;

  const roleEl = document.createElement("div");
  roleEl.className = "role";
  roleEl.textContent = role;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;

  wrap.appendChild(roleEl);
  wrap.appendChild(bubble);
  chatEl.appendChild(wrap);
  scrollToBottom();
}

function renderHistory() {
  chatEl.innerHTML = "";
  if (history.length === 0) { renderEmptyState(); return; }
  for (const msg of history) {
    if (msg.role === "user") renderMessage("You", msg.content, "user");
    else                     renderMessage("AI",  msg.content, "ai");
  }
}

function showTypingIndicator() {
  const wrap = document.createElement("div");
  wrap.className = "msg ai typing";
  wrap.id = "typing-indicator";
  wrap.innerHTML =
    '<div class="role">AI</div><div class="bubble">' +
    '<span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
    "</div>";
  chatEl.appendChild(wrap);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

function scrollToBottom() { chatEl.scrollTop = chatEl.scrollHeight; }

function setStatus(state) {
  statusDot.className = "status-dot" + (state === "ready" ? "" : " " + state);
  statusDot.title = state === "busy" ? "Thinking…" : state === "error" ? "Error" : "Ready";
}

// ---------- Privacy UI helpers ----------

function isPrivacyEnabled() {
  return !!(privacyEnabledEl && privacyEnabledEl.checked);
}

function reflectPrivacyToggle() {
  const on = isPrivacyEnabled();
  privacyStateEl.textContent = on ? "ON" : "OFF";
  privacyStateEl.classList.toggle("off", !on);
}

function setPrivacyStatus(kind, text) {
  privacyStatusEl.className = "privacy-status" + (kind ? " " + kind : "");
  privacyStatusEl.textContent = text || "";
}

// Human labels for PII category slugs
const PII_LABELS = {
  name:          "Name",
  email:         "Email",
  password:      "Password",
  age:           "Age",
  phone:         "Phone Number",
  address:       "Address",
  username:      "Username",
  date_of_birth: "Date of Birth",
  credit_card:   "Card Number",
  ssn:           "Aadhaar / PAN / ID",
  api_key:       "API Key / Token",
  bank_account:  "Bank Account",
};

function humanLabel(category) {
  return PII_LABELS[category] || category;
}

function countByCategory(detections) {
  const counts = {};
  for (const d of detections || []) {
    counts[d.category] = (counts[d.category] || 0) + 1;
  }
  return counts;
}

// ---------- V3 privacy summary UI ----------

function renderPrivacySummary(result) {
  const dets        = result.detectedElements || [];
  const uninspectable = result.uninspectable || [];
  const ocrEnabled  = !!result.ocrEnabled;
  const ocrWC       = result.ocrWordCount || 0;

  if (dets.length === 0 && uninspectable.length === 0) {
    const mode = ocrEnabled ? "DOM+OCR" : "DOM-only";
    setPrivacyStatus(
      "ok",
      "No sensitive fields detected (" + mode + " scan). Page snapshot attached."
    );
    return;
  }

  const counts = countByCategory(dets);
  let html = "Detected:&nbsp;";
  const parts = Object.keys(counts).map(
    k => "<span class='det-chip'>" + counts[k] + " " + humanLabel(k) + "</span>"
  );
  html += parts.join(" ");

  if (ocrEnabled && ocrWC > 0) {
    html += "<span class='ocr-badge'>+ OCR (" + ocrWC + " words)</span>";
  }
  if (uninspectable.length) {
    html += "<div class='uninspectable-note'>" +
            uninspectable.length + " uninspectable region(s) — cross-origin iframe, not scanned.</div>";
  }

  privacyStatusEl.className = "privacy-status ok";
  privacyStatusEl.innerHTML = html;

  // Populate debug panel
  populateDebugPanel(dets, result.fusionSummary, ocrEnabled, ocrWC);
}

// ---------- V3 Scan Panel ----------

/**
 * Run the full V3 pipeline standalone (no Gemini send) and show results.
 */
async function handleScan() {
  if (scanBtn.disabled) return;
  scanBtn.disabled = true;
  scanBtn.textContent = "Scanning…";
  setPrivacyStatus("working", "Starting scan…");

  // Hide any previous result while scanning
  scanResultPanel.classList.add("hidden");

  try {
    const result = await window.PrivacyEngine.scanPage(m =>
      setPrivacyStatus("working", m)
    );
    renderScanResult(result);
    renderPrivacySummary(result);
  } catch (err) {
    const msg = (err && err.message) || "Unknown error during scan.";
    setPrivacyStatus("err", "Scan failed: " + msg);
    console.error("[Scan]", err);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = "🛡 Scan Page";
  }
}

/**
 * Populate and show the scan result panel.
 */
function renderScanResult(result) {
  const dets      = result.detectedElements || [];
  const summary   = result.fusionSummary   || {};
  const ocrOn     = !!result.ocrEnabled;

  // Count by source (for DOM / OCR card)
  let domCount = 0, ocrCount = 0;
  for (const d of dets) {
    const srcs = d.sources || ["dom"];
    if (srcs.indexOf("dom") !== -1) domCount++;
    if (srcs.some(s => s !== "dom")) ocrCount++;
  }

  cardDomEl.textContent   = domCount;
  cardOcrEl.textContent   = ocrCount;
  cardFusedEl.textContent = dets.length;

  guaranteeOcrEl.textContent = ocrOn ? "✓ OCR active" : "✓ DOM scan active";

  // Category chips
  const counts = countByCategory(dets);
  scanCategoriesEl.innerHTML = Object.keys(counts).map(k =>
    `<span class="scan-cat-chip">${counts[k]} ${humanLabel(k)}</span>`
  ).join("");

  // Screenshots
  if (result.beforeScreenshot) {
    imgOriginalEl.src   = result.beforeScreenshot;
    tabOriginalBtn.style.display = "";
  } else {
    // No before screenshot available — hide the Original tab
    tabOriginalBtn.style.display = "none";
  }
  imgSanitizedEl.src  = result.sanitizedScreenshot || "";

  // Default to sanitized tab
  activateTab("sanitized");

  // Debug panel population
  populateDebugPanel(dets, summary, ocrOn, result.ocrWordCount || 0);

  // Show the panel
  scanResultPanel.classList.remove("hidden");
  scanResultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function activateTab(which) {
  const isOriginal = which === "original";
  shotOriginalEl.classList.toggle("hidden", !isOriginal);
  shotSanitizedEl.classList.toggle("hidden", isOriginal);
  tabOriginalBtn.classList.toggle("shot-tab-active", isOriginal);
  tabSanitizedBtn.classList.toggle("shot-tab-active", !isOriginal);
}

// ---------- V3 Debug panel ----------

function populateDebugPanel(detections, fusionSummary, ocrEnabled, ocrWordCount) {
  if (!detections || detections.length === 0) {
    debugListEl.innerHTML = '<span class="debug-empty">No detections this run.</span>';
    return;
  }

  const mode = ocrEnabled ? "DOM + OCR + Pattern + Context + Fusion" : "DOM-only (OCR fallback)";
  let html = '<div class="debug-mode">Mode: ' + mode + '</div>';

  if (ocrEnabled) {
    html += '<div class="debug-mode">OCR words found: ' + (ocrWordCount || 0) + '</div>';
  }

  // Source summary
  if (fusionSummary && fusionSummary.bySource) {
    html += '<div class="debug-section">Source breakdown:</div>';
    for (const [src, count] of Object.entries(fusionSummary.bySource)) {
      html += '<div class="debug-src-row"><span class="src-key">' + src + '</span>: ' + count + '</div>';
    }
  }

  html += '<div class="debug-section">Detections:</div>';
  for (const d of detections) {
    const conf = typeof d.confidence === "number"
      ? (d.confidence * 100).toFixed(0) + "%"
      : String(d.confidence);
    const confClass = d.confidence >= 0.80 ? "conf-high"
                    : d.confidence >= 0.60 ? "conf-med"
                    : "conf-low";
    const sources = (d.sources || ["dom"]).join(" + ");
    const action = d.confidence >= 0.60 ? "REDACTED" : "IGNORED";
    const actionClass = action === "REDACTED" ? "action-redacted" : "action-ignored";

    html +=
      '<div class="debug-item">' +
        '<span class="det-type">' + humanLabel(d.category) + '</span>' +
        '<span class="det-sources">Sources: ' + sources + '</span>' +
        '<span class="det-conf ' + confClass + '">Confidence: ' + conf + '</span>' +
        '<span class="det-action ' + actionClass + '">' + action + '</span>' +
      '</div>';
  }

  debugListEl.innerHTML = html;
}

// ---------- Page context text for Gemini ----------

function buildPageContextText(result) {
  const dom  = result.sanitizedDOM || {};
  const dets = result.detectedElements || [];
  const lines = [];

  lines.push("[V3 Privacy-sanitised page context — produced locally by the extension]");
  lines.push("Source host: " + (result.host || "unknown"));
  lines.push("Scan mode: " + (result.ocrEnabled ? "DOM + OCR + Pattern + Context + Fusion" : "DOM-only (OCR unavailable)"));
  lines.push("This scan inspects the DOM and visible rendered content (via local OCR). It does NOT analyse image semantics for non-text sensitive data.");

  if (dets.length) {
    const counts = countByCategory(dets);
    lines.push(
      "Detected sensitive regions (values redacted): " +
        Object.keys(counts).map(k => counts[k] + " " + k).join(", ")
    );
    // List sources per category
    const byCategory = {};
    for (const d of dets) {
      if (!byCategory[d.category]) byCategory[d.category] = new Set();
      (d.sources || ["dom"]).forEach(s => byCategory[d.category].add(s));
    }
    lines.push(
      "Evidence sources: " +
        Object.entries(byCategory)
          .map(([k, s]) => k + "=[" + [...s].join(",") + "]")
          .join(", ")
    );
  } else {
    lines.push("No sensitive DOM fields or OCR text were detected.");
  }

  if (result.uninspectable && result.uninspectable.length) {
    lines.push(
      result.uninspectable.length +
        " cross-origin iframe(s) could NOT be inspected; treat those regions as unknown."
    );
  }

  lines.push("Sanitised DOM (JSON, contains NO sensitive values): " + JSON.stringify(dom));
  lines.push("The attached screenshot has every sensitive region covered by an opaque block.");
  return lines.join("\n");
}

async function loadPrivacyPref() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY_PRIVACY);
    const val  = data[STORAGE_KEY_PRIVACY];
    privacyEnabledEl.checked = val === undefined ? true : !!val;
  } catch (e) {
    console.error("Failed to load privacy pref:", e);
    privacyEnabledEl.checked = true;
  }
  reflectPrivacyToggle();
}

// ---------- Storage ----------

async function loadHistory() {
  try {
    const data  = await chrome.storage.local.get(STORAGE_KEY_HISTORY);
    const saved = data[STORAGE_KEY_HISTORY];
    history = Array.isArray(saved) ? saved : [];
  } catch (e) {
    console.error("Failed to load chat history:", e);
    history = [];
  }
  renderHistory();
}

async function saveHistory() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_HISTORY]: history });
  } catch (e) {
    console.error("Failed to save chat history:", e);
  }
}

// ---------- Send flow ----------

function setSending(sending) {
  isSending       = sending;
  sendBtn.disabled = sending;
  sendBtn.textContent = sending ? "…" : "Send";
  setStatus(sending ? "busy" : "ready");
}

async function handleSend() {
  if (isSending) return;

  const text = inputEl.value.trim();
  if (!text) return;

  if (chatEl.querySelector(".empty-state")) chatEl.innerHTML = "";

  renderMessage("You", text, "user");
  inputEl.value = "";
  autoGrow();

  const priorHistory = history.slice();
  history.push({ role: "user", content: text });
  await saveHistory();

  setSending(true);
  showTypingIndicator();

  // ---- V3 privacy pipeline ------------------------------------------------
  let geminiOptions = {};
  if (isPrivacyEnabled()) {
    try {
      setPrivacyStatus("working", "Scanning page…");
      const result = await window.PrivacyEngine.sanitizeCurrentPage(m =>
        setPrivacyStatus("working", m)
      );
      renderPrivacySummary(result);
      geminiOptions = {
        imageDataUrl: result.sanitizedScreenshot,
        pageContext:  buildPageContextText(result),
      };
    } catch (privErr) {
      // Mandatory fail-closed: privacy pipeline error → block the request.
      console.error(
        "Privacy pipeline failed:",
        (privErr && privErr.message) || privErr
      );
      removeTypingIndicator();
      setPrivacyStatus("err", "Sanitisation failed — request blocked.");
      renderMessage(
        "AI",
        "Privacy sanitisation failed. The request was not sent.\n\n" +
          "Reason: " + ((privErr && privErr.message) || "unknown error") +
          "\n\nTip: turn off Privacy Protection to chat without page context.",
        "error"
      );
      setStatus("error");
      setSending(false);
      inputEl.focus();
      return;
    }
  } else {
    setPrivacyStatus("", "");
  }

  try {
    const reply = await window.Gemini.sendMessage(text, priorHistory, geminiOptions);
    removeTypingIndicator();
    renderMessage("AI", reply, "ai");
    history.push({ role: "assistant", content: reply });
    await saveHistory();
  } catch (err) {
    console.error("Send failed:", err);
    removeTypingIndicator();
    const friendly = err && err.message
      ? err.message
      : "Sorry, something went wrong while contacting Gemini.";
    renderMessage("AI", friendly, "error");
    setStatus("error");
  } finally {
    setSending(false);
    inputEl.focus();
  }
}

// ---------- Clear chat ----------

async function handleClear() {
  history = [];
  try {
    await chrome.storage.local.remove(STORAGE_KEY_HISTORY);
  } catch (e) {
    console.error("Failed to clear stored history:", e);
  }
  renderEmptyState();
  setStatus("ready");
  inputEl.focus();
}

// ---------- Settings ----------

async function openSettings() {
  settingsPanel.classList.remove("hidden");
  settingsStatus.textContent = "";
  settingsStatus.className = "settings-status";
  try {
    const key = await window.Gemini.getApiKey();
    apiKeyInput.value = key || "";
  } catch (e) { console.error(e); }
  apiKeyInput.focus();
}

function closeSettings() { settingsPanel.classList.add("hidden"); }

async function saveKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    settingsStatus.textContent = "Enter a key before saving.";
    settingsStatus.className = "settings-status err";
    return;
  }
  try {
    await window.Gemini.setApiKey(key);
    settingsStatus.textContent = "Saved. You can start chatting.";
    settingsStatus.className = "settings-status ok";
  } catch (e) {
    console.error("Failed to save key:", e);
    settingsStatus.textContent = "Could not save the key.";
    settingsStatus.className = "settings-status err";
  }
}

// ---------- Input behaviour ----------

function autoGrow() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
}

inputEl.addEventListener("input", autoGrow);
inputEl.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

sendBtn.addEventListener("click", handleSend);
clearBtn.addEventListener("click", handleClear);

settingsBtn.addEventListener("click", () => {
  if (settingsPanel.classList.contains("hidden")) openSettings();
  else closeSettings();
});
saveKeyBtn.addEventListener("click", saveKey);
closeSettingsBtn.addEventListener("click", closeSettings);

// ---------- Privacy toggle ----------
privacyEnabledEl.addEventListener("change", async () => {
  reflectPrivacyToggle();
  setPrivacyStatus("", "");
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_PRIVACY]: privacyEnabledEl.checked });
  } catch (e) { console.error("Failed to save privacy pref:", e); }
});

privacyInfoBtn.addEventListener("click", () => {
  privacyDetailEl.classList.toggle("hidden");
});

// ---------- Zoom lightbox ----------
function openZoom(src) {
  zoomImg.src = src;
  zoomOverlay.classList.add("open");
}
function closeZoom() {
  zoomOverlay.classList.remove("open");
  zoomImg.src = "";
}
// Click thumbnail → open zoom
imgOriginalEl.addEventListener("click",  () => imgOriginalEl.src  && openZoom(imgOriginalEl.src));
imgSanitizedEl.addEventListener("click", () => imgSanitizedEl.src && openZoom(imgSanitizedEl.src));
// Close on overlay background, close button, or Escape
zoomOverlay.addEventListener("click", e => { if (e.target === zoomOverlay) closeZoom(); });
zoomCloseBtn.addEventListener("click", closeZoom);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeZoom(); });

// ---------- V3 Scan button ----------
scanBtn.addEventListener("click", handleScan);
scanResultCloseBtn.addEventListener("click", () => {
  scanResultPanel.classList.add("hidden");
});
tabOriginalBtn.addEventListener("click", () => activateTab("original"));
tabSanitizedBtn.addEventListener("click", () => activateTab("sanitized"));

// ---------- V3 Debug panel ----------
debugBtn.addEventListener("click", () => {
  debugPanel.classList.toggle("hidden");
});
debugCloseBtn.addEventListener("click", () => {
  debugPanel.classList.add("hidden");
});

// ======================================================================
// V4 AGENT MODE
// ======================================================================

// ---------- Mode toggle ----------

function switchMode(mode) {
  currentMode = mode;
  const inAgent = mode === "agent";

  // Update tab button states
  modeChatBtn.classList.toggle("mode-tab-active", !inAgent);
  modeAgentBtn.classList.toggle("mode-tab-active",  inAgent);
  modeChatBtn.setAttribute("aria-selected", String(!inAgent));
  modeAgentBtn.setAttribute("aria-selected", String( inAgent));

  // Show / hide panels
  chatModePanel.classList.toggle("hidden",  inAgent);
  agentModePanel.classList.toggle("hidden", !inAgent);

  if (inAgent) {
    agentInputEl.focus();
  } else {
    inputEl.focus();
  }
}

modeChatBtn.addEventListener("click", () => switchMode("chat"));
modeAgentBtn.addEventListener("click", () => switchMode("agent"));

// ---------- Quick-task shortcuts ----------

document.querySelectorAll(".quick-task-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const task = btn.getAttribute("data-task");
    if (task) {
      agentInputEl.value = task;
      agentInputEl.dispatchEvent(new Event("input"));
    }
  });
});

// ---------- Agent step log UI helpers ----------

const STEP_ICONS = {
  success:  "✓",
  error:    "✗",
  working:  "⟳",
  rejected: "⚠",
  complete: "✓",
  done:     "✓",
};

const TOOL_LABELS = {
  scan_dom:         "scan_dom",
  take_screenshot:  "take_screenshot",
  scan_ocr:         "scan_ocr",
  fuse_detections:  "fuse_detections",
  redact:           "redact",
  verify_redaction: "verify_redaction",
  get_page_context: "get_page_context",
  done:             "agent",
  llm:              "llm",
};

// Map from step number to DOM element (for live updates)
const stepElements = {};

function addOrUpdateStep(entry) {
  const icon  = STEP_ICONS[entry.status] || "·";
  const label = TOOL_LABELS[entry.tool]  || entry.tool;

  // Duration string (only for completed steps with meaningful duration)
  const durStr = entry.duration > 0
    ? (entry.duration < 1000 ? entry.duration + "ms" : (entry.duration / 1000).toFixed(1) + "s")
    : "";

  const stepKey = String(entry.step) + "_" + entry.tool;

  if (stepElements[stepKey]) {
    // Update existing element (e.g. "working" → "success")
    const el = stepElements[stepKey];
    el.className = "agent-step status-" + entry.status;
    el.querySelector(".agent-step-icon").textContent = icon;
    el.querySelector(".agent-step-msg").textContent  = entry.message;
    if (durStr) el.querySelector(".agent-step-duration").textContent = durStr;
    return;
  }

  const el = document.createElement("div");
  el.className = "agent-step status-" + entry.status;
  el.innerHTML =
    '<span class="agent-step-icon">' + icon + '</span>' +
    '<span class="agent-step-body">' +
      '<span class="agent-step-tool">' + label + '</span> ' +
      '<span class="agent-step-msg">' + entry.message + '</span>' +
    '</span>' +
    '<span class="agent-step-duration">' + durStr + '</span>';

  agentStepList.appendChild(el);
  stepElements[stepKey] = el;
  agentStepList.scrollTop = agentStepList.scrollHeight;
}

function resetAgentLog() {
  agentStepList.innerHTML = "";
  for (const key in stepElements) delete stepElements[key];
  agentLogPanel.classList.add("hidden");
  agentResultPanel.classList.add("hidden");
  agentScreenshotSection.classList.add("hidden");
  agentResultImg.src = "";
  agentResultText.textContent = "";
}

// ---------- Main agent run handler ----------

async function handleAgentRun() {
  if (isAgentRunning) return;

  const task = agentInputEl.value.trim();
  if (!task) {
    agentInputEl.focus();
    return;
  }

  // Check API key
  const apiKey = await window.Gemini.getApiKey().catch(() => "");
  if (!apiKey) {
    agentResultText.textContent =
      "Please configure your Gemini API key in Settings (⚙ top right) before running the agent.";
    agentResultPanel.classList.remove("hidden");
    return;
  }

  // --- Reset and start ---
  isAgentRunning = true;
  agentRunBtn.disabled = true;
  agentRunBtn.textContent = "Running…";
  setStatus("busy");

  resetAgentLog();
  agentLogPanel.classList.remove("hidden");
  agentLogStatus.textContent = "Running…";
  agentLogStatus.className = "agent-log-status-badge";

  // --- Run agent ---
  try {
    const result = await window.AgentManager.run(task, apiKey, (stepEntry) => {
      addOrUpdateStep(stepEntry);
    });

    // Update log status
    agentLogStatus.textContent = result.success ? "Completed ✓" : "Stopped";
    agentLogStatus.className = "agent-log-status-badge " + (result.success ? "done" : "error");

    // Show result text
    agentResultText.textContent = result.summary || (result.success ? "Task complete." : "Task did not complete.");
    agentResultPanel.classList.remove("hidden");

    // Show redacted screenshot if available
    if (result.redactedScreenshot) {
      agentResultImg.src = result.redactedScreenshot;
      agentScreenshotSection.classList.remove("hidden");
      // Allow zoom on the agent result image
      agentResultImg.style.cursor = "zoom-in";
      agentResultImg.onclick = () => openZoom(agentResultImg.src);
    }

  } catch (err) {
    console.error("[Agent] Unexpected error:", err);
    agentLogStatus.textContent = "Error";
    agentLogStatus.className = "agent-log-status-badge error";
    agentResultText.textContent = "Agent error: " + ((err && err.message) || "Unknown error.");
    agentResultPanel.classList.remove("hidden");
  } finally {
    isAgentRunning = false;
    agentRunBtn.disabled = false;
    agentRunBtn.textContent = "▶ Run";
    setStatus("ready");
  }
}

agentRunBtn.addEventListener("click", handleAgentRun);

agentInputEl.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAgentRun(); }
});

agentResultClose.addEventListener("click", () => {
  agentResultPanel.classList.add("hidden");
  agentScreenshotSection.classList.add("hidden");
});

// ---------- Init ----------

(async function init() {
  setStatus("ready");
  await loadPrivacyPref();
  await loadHistory();

  try {
    const key = await window.Gemini.getApiKey();
    if (!key) {
      if (chatEl.querySelector(".empty-state")) chatEl.innerHTML = "";
      renderMessage(
        "AI",
        "Please configure your Gemini API key in Settings (⚙ top right).",
        "error"
      );
    }
  } catch (e) { console.error(e); }

  inputEl.focus();
})();
