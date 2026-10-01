// Single source of truth for the Gemini model id used by the extension.
//
// Both the chat client (src/gemini.js) and the agent client
// (src/agent/llmClient.js) import this. When Google deprecates a model,
// change it here only. The server side has its own equivalent in
// server/config.py — update both when migrating.
//
// Verify current ids at https://aistudio.google.com/ or:
//   curl -s "https://generativelanguage.googleapis.com/v1beta/models" \
//        -H "x-goog-api-key: $GEMINI_API_KEY"
export const GEMINI_MODEL = 'gemini-3-flash-preview';
