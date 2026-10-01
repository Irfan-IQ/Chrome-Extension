# Changelog

All notable changes to Redact Agent are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once a
release is tagged.

## [Unreleased] — Audit & Optimization Pass

### Follow-ups after Phase 7
- Migrated from the deprecated `gemini-2.0-flash` to `gemini-3-flash-preview`
  (verified against Google AI Studio, not the API error body — the error
  suggested a non-existent `gemini-3.8-flash`).
- **Centralised the client-side model id** in `src/modelConfig.js`. Both
  `src/gemini.js` and `src/agent/llmClient.js` now import it; the previous
  8 scattered string literals collapsed to 3 definition sites (client
  constant, server env default, `.env.example`).
- `server/main.py`'s `/v1/models` list now derives from `settings.GEMINI_MODEL`
  rather than a hardcoded string, and de-duplicates when the active model
  equals a default.


Scoped, phased refactor driven by a code audit. No user-visible feature
changes; the agent and chat flows behave as before.

### Security
- **Model id**: replaced the non-existent `gemini-3.6-flash` with the
  real `gemini-2.0-flash` in both the chat client (`src/gemini.js`) and
  the agent client (`src/agent/llmClient.js`). Previously every call
  would fail until the user overrode it.
- **XSS**: removed `dangerouslySetInnerHTML` from `ChatMode.jsx`. The
  privacy summary is now composed with React JSX, which escapes every
  interpolated value. Category labels sourced from scanned pages can no
  longer land in a privileged `innerHTML` sink.
- **Host permissions**: narrowed `host_permissions` and
  `web_accessible_resources.matches` from `<all_urls>` to `http://*/*` +
  `https://*/*`, dropping `file://`, `data:`, and other unexpected
  schemes.
- **Tool payload cap**: added `clampPayload` in `llmClient.js`. Every
  tool result handed to the LLM is first stripped of PII-carrying
  fields, then arrays are truncated to 64 items, then the whole thing
  falls back to a bare `{success, error}` header if the JSON still
  exceeds 16 KB. Prevents runaway context + API cost.
- **Server auth**: optional shared-secret `AUTH_TOKEN` on the FastAPI
  gateway, verified with `hmac.compare_digest` against the
  `X-Redact-Agent-Token` header. Opt-in: empty token = unchanged
  behaviour. Extension client sends the header from `chrome.storage.local`
  when configured via Settings.
- **CORS**: `allow_headers` tightened from `"*"` to the explicit
  `Content-Type`, `X-Redact-Agent-Token`. Startup logs a warning when
  `CORS_ORIGINS='*' && DEBUG=false` (likely production misconfig).

### Repository hygiene
- Deleted two duplicate copies of the vision model (`vision-model/vision-model-main*`),
  ~4.4 MB of dead code that was splitting grep hits.
- Hardened `.gitignore` (vision-model build output, server venv/pycache,
  `*.env`, ONNX binaries, tool caches).
- Moved `server-request-letter.{md,docx}` to `docs/misc/` (kept but out
  of the repo root).
- Renamed `privacy/` (page-realm injected scripts) → `src/privacy-page/`;
  both privacy trees now live under `src/`. Updated `vite.config.js`
  static-copy source accordingly. Runtime paths in `dist/privacy/` are
  unchanged, so `chrome.scripting.executeScript` still resolves them.

### Build & bundle
- Switched `onnxruntime-web` to its `/wasm` sub-entry — **drops the
  shipped WASM blob from 28.3 MB → 14.2 MB** (−14 MB) and the YuNet
  worker JS from 417 KB → 77 KB.
- Code-split `AgentMode` with `React.lazy` + `Suspense`; chat-only
  users no longer download the agent subtree.
- Added `manualChunks` splitting React into its own chunk.
- First-paint `sidepanel.js` dropped from **235 KB → 54 KB** (−77%).

### Code quality
- **Killed 44 `window.*` module bridges.** `window.{Gemini,
  PrivacyEngine, AgentManager, PatternAnalyzer, ContextAnalyzer,
  OcrAnalyzer, DetectionFusion, ScreenshotRedactor, VisionEngine}` are
  gone — every consumer now imports directly. Only
  `window.CoordinateUtils` + `window.Tesseract` remain, intentionally
  (classic scripts shared with the page-realm).
- Split `ChatMode.jsx` (549 LOC) → `ChatMode.jsx` (423 LOC) +
  `ScanResultPanel.jsx` + `DebugList.jsx`.
- `PrivacyError` prototype-chain hack → `class PrivacyError extends Error`.
- Agent system prompt moved out of `llmClient.js` into
  `src/agent/systemPrompt.md`, imported via Vite `?raw`.

### Performance
- **Pipeline cache**: `sanitizeCurrentPage` memoises the full result
  per `(tabId, url)` with a 10 s TTL. Repeated chat messages in the
  same tab reuse the previous scan instead of re-running the full
  screenshot + DOM + OCR + vision + fusion pipeline. Invalidated
  eagerly on `tabs.onUpdated` and `tabs.onRemoved`.
- **Fusion**: category-indexed buckets + AABB short-circuit replace the
  O(dom × ocr) scan. `deduplicateRects` now pairwise-scans each
  category independently with early-exit on winners.
- **Debug gating**: central `src/debug.js` with build-time + runtime
  flags. All 7 `console.debug` sites in `src/privacy/*` route through
  it. Page-realm `src/privacy-page/*` scripts use a local
  `window.__REDACT_DEBUG` guard. Prod console is silent by default.

### Server
- `LocalVLMProvider` no longer swallows exceptions silently. Connect
  errors still fall back to the placeholder (dev ergonomics), but a
  reachable-but-broken runner now returns `502 Bad Gateway` with the
  upstream status/body so bugs surface instead of hiding.
- Test suite rewritten with `respx`-mocked outbound Gemini calls. No
  network access or real API key needed. Suite grew from 5 → 9 tests.

### Docs
- Fixed README's broken links (`ARCHITECTURE.md` /
  `AGENT_ARCHITECTURE.md` now point at the merged `docs/ARCHITECTURE.md`).
- Added this `CHANGELOG.md` and a `CONTRIBUTING.md`.

---

## [3.0.0] — V4 Agent Mode (prior baseline)

Baseline recorded here for continuity. The extension was already at
`version: 3.0.0` in `package.json` / `manifest.json` with the following
feature set when this audit pass began.

### Added
- **Agent Mode** — an LLM-driven agent that orchestrates the privacy
  pipeline step by step via Gemini native function calling. Live step
  log, quick-task shortcuts, and before/after screenshot comparison.
- **ToolRegistry / ToolValidator / ToolExecutor** — security layer: the
  LLM may only call a predefined set of tools, each argument validated,
  no dynamic dispatch.
- **Vision layer** — YuNet (face detection) + OpenCV (card-like
  quadrilateral candidates) running in dedicated web workers alongside
  the OCR + pattern + context fusion pipeline.
- **V4 hybrid privacy engine** — DOM scan + Tesseract OCR + regex
  pattern + context/NER + detection fusion, all local.
- Side-panel React UI (Chat + Agent tabs) rebuilt from the earlier
  vanilla-JS prototype.

### Design invariants (unchanged since V3 and preserved by this audit)
- Raw PII values never leave the browser.
- Raw screenshot never leaves the browser — only the opaque-block-masked
  version is sent to Gemini.
- The LLM only ever sees detection IDs, categories, confidence scores.
