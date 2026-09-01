// sidepanel.js — UI logic only. Gemini communication lives in gemini.js.

const STORAGE_KEY_HISTORY = "chatHistory";
const STORAGE_KEY_PRIVACY = "privacyEnabled"; // V2: default ON

// In-memory conversation. Each item: { role: "user" | "assistant", content: string }
let history = [];
let isSending = false;

// ---------- Element refs ----------
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const clearBtn = document.getElementById("clear-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const apiKeyInput = document.getElementById("api-key-input");
const saveKeyBtn = document.getElementById("save-key-btn");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const settingsStatus = document.getElementById("settings-status");
const statusDot = document.getElementById("status-dot");

// ---------- V2 privacy element refs ----------
const privacyEnabledEl = document.getElementById("privacy-enabled");
const privacyStateEl = document.getElementById("privacy-state");
const privacyStatusEl = document.getElementById("privacy-status");
const privacyDetailEl = document.getElementById("privacy-detail");
const privacyInfoBtn = document.getElementById("privacy-info-btn");

// ---------- Rendering ----------

function renderEmptyState() {
  chatEl.innerHTML =
    '<div class="empty-state">Ask the assistant anything to get started.</div>';
}

function renderMessage(role, content, kind) {
  // kind: "user" | "ai" | "error"
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
  if (history.length === 0) {
    renderEmptyState();
    return;
  }
  for (const msg of history) {
    if (msg.role === "user") {
      renderMessage("You", msg.content, "user");
    } else {
      renderMessage("AI", msg.content, "ai");
    }
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

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function setStatus(state) {
  // state: "ready" | "busy" | "error"
  statusDot.className = "status-dot" + (state === "ready" ? "" : " " + state);
  statusDot.title =
    state === "busy" ? "Thinking…" : state === "error" ? "Error" : "Ready";
}

// ---------- V2 privacy UI helpers ----------

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

// Human labels for the category slugs the detector emits.
const PII_LABELS = {
  name: "Name",
  email: "Email",
  password: "Password",
  age: "Age",
  phone: "Phone Number",
  address: "Address",
  username: "Username",
  date_of_birth: "Date of Birth",
  credit_card: "Card Number",
};

function countByCategory(detections) {
  const counts = {};
  for (const d of detections || []) {
    counts[d.category] = (counts[d.category] || 0) + 1;
  }
  return counts;
}

// Show counts ONLY — never a detected value.
function renderPrivacySummary(result) {
  const dets = result.detectedElements || [];
  const uninspectable = result.uninspectable || [];

  if (dets.length === 0 && uninspectable.length === 0) {
    setPrivacyStatus(
      "ok",
      "No sensitive DOM fields detected. Sent a sanitized page snapshot."
    );
    return;
  }

  const counts = countByCategory(dets);
  let html = "Privacy Protection: ON — Detected:<ul>";
  for (const key of Object.keys(counts)) {
    html += "<li>" + counts[key] + " " + (PII_LABELS[key] || key) + "</li>";
  }
  html += "</ul>";
  if (uninspectable.length) {
    html +=
      uninspectable.length +
      " uninspectable region(s) — cross-origin iframe, not scanned.";
  }
  privacyStatusEl.className = "privacy-status ok";
  // Content is built only from our own numbers + fixed label strings.
  privacyStatusEl.innerHTML = html;
}

// Compact text block describing the SANITIZED page (no values) for Gemini.
function buildPageContextText(result) {
  const dom = result.sanitizedDOM || {};
  const dets = result.detectedElements || [];
  const lines = [];
  lines.push(
    "[Privacy-sanitized page context — produced locally by the extension, DOM-only]"
  );
  lines.push("Source host: " + (result.host || "unknown"));
  lines.push(
    "This scan inspects the DOM only. It does NOT analyse image contents for sensitive data."
  );

  if (dets.length) {
    const counts = countByCategory(dets);
    lines.push(
      "Detected sensitive fields (values redacted): " +
        Object.keys(counts)
          .map((k) => counts[k] + " " + k)
          .join(", ")
    );
  } else {
    lines.push("No sensitive DOM fields were detected.");
  }
  if (result.uninspectable && result.uninspectable.length) {
    lines.push(
      result.uninspectable.length +
        " cross-origin iframe(s) could NOT be inspected; treat those regions as unknown."
    );
  }
  lines.push(
    "Sanitized DOM (JSON, contains NO sensitive values): " + JSON.stringify(dom)
  );
  lines.push(
    "The attached screenshot has every sensitive region covered by an opaque block."
  );
  return lines.join("\n");
}

async function loadPrivacyPref() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY_PRIVACY);
    const val = data[STORAGE_KEY_PRIVACY];
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
    const data = await chrome.storage.local.get(STORAGE_KEY_HISTORY);
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
  isSending = sending;
  sendBtn.disabled = sending;
  sendBtn.textContent = sending ? "…" : "Send";
  setStatus(sending ? "busy" : "ready");
}

async function handleSend() {
  if (isSending) return; // prevent duplicate requests

  const text = inputEl.value.trim();
  if (!text) return; // no empty messages

  // Clear empty-state if present.
  if (chatEl.querySelector(".empty-state")) chatEl.innerHTML = "";

  // Show user message immediately.
  renderMessage("You", text, "user");
  inputEl.value = "";
  autoGrow();

  // Snapshot history BEFORE adding the new user turn (gemini.js appends it).
  const priorHistory = history.slice();
  history.push({ role: "user", content: text });
  await saveHistory();

  setSending(true);
  showTypingIndicator();

  // ---- V2: run the local privacy pipeline BEFORE contacting Gemini ----
  let geminiOptions = {};
  if (isPrivacyEnabled()) {
    try {
      setPrivacyStatus("working", "Scanning page...");
      const result = await window.PrivacyEngine.sanitizeCurrentPage((m) =>
        setPrivacyStatus("working", m)
      );
      renderPrivacySummary(result);
      // Only SANITIZED artefacts are forwarded. The raw screenshot / raw DOM
      // never left privacyEngine.sanitizeCurrentPage().
      geminiOptions = {
        imageDataUrl: result.sanitizedScreenshot,
        pageContext: buildPageContextText(result),
      };
    } catch (privErr) {
      // MANDATORY fail-closed: if sanitization fails we send NOTHING.
      console.error(
        "Privacy pipeline failed:",
        (privErr && privErr.message) || privErr
      );
      removeTypingIndicator();
      setPrivacyStatus("err", "Sanitization failed — request blocked.");
      renderMessage(
        "AI",
        "Privacy sanitization failed. The request was not sent.\n\nReason: " +
          ((privErr && privErr.message) || "unknown error") +
          "\n\nTip: switch off Privacy Protection above to chat without page context.",
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
    const reply = await window.Gemini.sendMessage(
      text,
      priorHistory,
      geminiOptions
    );
    removeTypingIndicator();
    renderMessage("AI", reply, "ai");
    history.push({ role: "assistant", content: reply });
    await saveHistory();
  } catch (err) {
    console.error("Send failed:", err);
    removeTypingIndicator();
    const friendly =
      err && err.message
        ? err.message
        : "Sorry, something went wrong while contacting Gemini.";
    renderMessage("AI", friendly, "error");
    setStatus("error");
    // Note: the failed user turn stays in history so the user can retry with context.
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
  } catch (e) {
    console.error(e);
  }
  apiKeyInput.focus();
}

function closeSettings() {
  settingsPanel.classList.add("hidden");
}

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

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
  // Shift+Enter falls through -> newline.
});

sendBtn.addEventListener("click", handleSend);
clearBtn.addEventListener("click", handleClear);
settingsBtn.addEventListener("click", () => {
  if (settingsPanel.classList.contains("hidden")) openSettings();
  else closeSettings();
});
saveKeyBtn.addEventListener("click", saveKey);
closeSettingsBtn.addEventListener("click", closeSettings);

// ---------- V2 privacy toggle ----------
privacyEnabledEl.addEventListener("change", async () => {
  reflectPrivacyToggle();
  setPrivacyStatus("", "");
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY_PRIVACY]: privacyEnabledEl.checked,
    });
  } catch (e) {
    console.error("Failed to save privacy pref:", e);
  }
});
privacyInfoBtn.addEventListener("click", () => {
  privacyDetailEl.classList.toggle("hidden");
});

// ---------- Init ----------

(async function init() {
  setStatus("ready");
  await loadPrivacyPref();
  await loadHistory();

  // If no key configured yet, nudge the user toward Settings.
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
  } catch (e) {
    console.error(e);
  }

  inputEl.focus();
})();
