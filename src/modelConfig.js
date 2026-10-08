// Single source of truth for the model ids the extension targets.
//
// There are two routes:
//
//  1. Self-hosted (default) — the FastAPI gateway at `serverUrl` proxies to a
//     vLLM instance running Qwen3-VL-30B-A3B-Instruct. The gateway surfaces
//     the real model id via /v1/models at runtime; LOCAL_MODEL is the display
//     label used in UI copy before that call lands.
//
//  2. Gemini cloud (opt-in) — the extension talks directly to Google's
//     generativelanguage API. GEMINI_MODEL must stay in sync with
//     server/config.py's GEMINI_MODEL when migrating. Verify current ids at
//     https://aistudio.google.com/ or:
//       curl -s "https://generativelanguage.googleapis.com/v1beta/models" \
//            -H "x-goog-api-key: $GEMINI_API_KEY"
export const LOCAL_MODEL = 'Qwen/Qwen3-VL-30B-A3B-Instruct';
export const LOCAL_MODEL_LABEL = 'Qwen3-VL 30B-A3B (self-hosted)';
export const GEMINI_MODEL = 'gemini-3-flash-preview';
export const GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash';

// Default backend when nothing is stored yet. Keep this aligned with the
// `useState` default in SettingsPanel.jsx and the destructuring defaults in
// gemini.js and agent/llmClient.js — a clean install should land on the
// local server, not Gemini.
export const DEFAULT_BACKEND_MODE = 'server';
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8000';
