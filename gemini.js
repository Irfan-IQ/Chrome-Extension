// gemini.js — all Google Gemini API communication lives here.
// No UI code. No DOM access. Just: take a message + history, return text.

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  GEMINI_MODEL +
  ":generateContent";

/**
 * Read the stored Gemini API key from chrome.storage.local.
 * @returns {Promise<string>} the key, or "" if none saved.
 */
async function getApiKey() {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  return (geminiApiKey || "").trim();
}

/**
 * Save the Gemini API key.
 * @param {string} key
 */
async function setApiKey(key) {
  await chrome.storage.local.set({ geminiApiKey: (key || "").trim() });
}

/**
 * Convert our internal history format into Gemini's "contents" array.
 * Internal: [{ role: "user" | "assistant", content: "..." }]
 * Gemini:   [{ role: "user" | "model", parts: [{ text: "..." }] }]
 *
 * @param {Array} history  prior turns
 * @param {Array} userParts  the parts array for the NEW user turn. In the
 *                 plain V1 path this is just [{ text: message }], so output is
 *                 byte-for-byte identical to before. V2 may append a
 *                 { inline_data } image part and/or an extra { text } context
 *                 part built from the *sanitized* page representation.
 */
function toGeminiContents(history, userParts) {
  const contents = [];
  for (const msg of history) {
    if (!msg || !msg.content) continue;
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: String(msg.content) }],
    });
  }
  contents.push({ role: "user", parts: userParts });
  return contents;
}

/**
 * Parse a `data:image/png;base64,...` URL into a Gemini inline_data part.
 * Returns null if the string is not a data URL.
 */
function dataUrlToInlinePart(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

/**
 * Send a message to Gemini with prior conversation context.
 *
 * @param {string} message - the new user message.
 * @param {Array<{role: string, content: string}>} conversationHistory
 * @param {{ imageDataUrl?: string, pageContext?: string }} [options]
 *        V2 optional extras. Both are already SANITIZED by the privacy engine
 *        before they get here — this function does no privacy work itself.
 *        - imageDataUrl: the redacted screenshot (opaque masks already burned in)
 *        - pageContext:  a short text block describing the sanitized DOM
 *        When options is omitted the request is identical to V1.
 * @returns {Promise<string>} the assistant's reply text.
 * @throws {Error} with a human-readable message on any failure.
 */
async function sendMessage(message, conversationHistory = [], options = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("Please configure your Gemini API key in Settings.");
  }

  // Build the parts for the new user turn.
  const userParts = [];
  if (options && options.pageContext) {
    userParts.push({ text: String(options.pageContext) });
  }
  if (options && options.imageDataUrl) {
    const imgPart = dataUrlToInlinePart(options.imageDataUrl);
    if (imgPart) userParts.push(imgPart);
  }
  userParts.push({ text: String(message) });

  const body = {
    contents: toGeminiContents(conversationHistory, userParts),
  };

  let response;
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    console.error("Gemini network error:", networkError);
    throw new Error(
      "Network error — could not reach Gemini. Check your connection."
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    console.error("Gemini response was not valid JSON:", parseError);
    throw new Error("Received an invalid response from Gemini.");
  }

  if (!response.ok) {
    const apiMessage =
      (data && data.error && data.error.message) || "Unknown API error.";
    console.error("Gemini API error:", response.status, data);

    if (response.status === 400 && /api key/i.test(apiMessage)) {
      throw new Error("Your Gemini API key looks invalid. Check it in Settings.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Gemini rejected the API key (unauthorized). Check it in Settings."
      );
    }
    if (response.status === 429) {
      throw new Error("Rate limit hit. Wait a moment and try again.");
    }
    throw new Error("Gemini API error: " + apiMessage);
  }

  // Prompt was blocked before any candidate was generated.
  if (data.promptFeedback && data.promptFeedback.blockReason) {
    throw new Error(
      "Your message was blocked by Gemini's safety filters (" +
        data.promptFeedback.blockReason +
        ")."
    );
  }

  const candidate = data.candidates && data.candidates[0];
  if (!candidate) {
    console.error("Gemini returned no candidates:", data);
    throw new Error("Gemini returned an empty response.");
  }

  if (candidate.finishReason === "SAFETY") {
    throw new Error("Gemini stopped the response due to safety filters.");
  }

  const parts =
    (candidate.content && candidate.content.parts) || [];
  const text = parts
    .map((p) => (p && p.text ? p.text : ""))
    .join("")
    .trim();

  if (!text) {
    console.error("Gemini candidate had no text:", candidate);
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

// Expose on window so sidepanel.js can use these without ES modules.
window.Gemini = { sendMessage, getApiKey, setApiKey, GEMINI_MODEL };
