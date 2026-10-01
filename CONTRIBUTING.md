# Contributing to Redact Agent

Welcome. This guide covers the local-dev loop, the handful of
non-obvious conventions in the codebase, and the invariants a change
must preserve to be accepted.

---

## Prerequisites

- **Node** 18 or newer (Vite 5 requires it).
- **Chrome** 114+ (Side Panel API).
- **Python** 3.11+ *only if* you intend to work on the optional
  FastAPI gateway in `server/`.
- A [Gemini API key](https://aistudio.google.com/app/apikey) for runtime
  testing in direct-cloud mode. The build and the test suites do **not**
  need one.

---

## Local-dev loop (extension)

```bash
npm install
npm run dev          # vite build --watch --mode development
```

Then in Chrome:

1. Open `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. **Load unpacked** → point at the `dist/` folder, not the repo root.
4. Click the extension's toolbar icon; the side panel opens.
5. Settings (⚙) → paste your Gemini API key.

After a code change, Vite recompiles into `dist/` automatically. You
still need to click the ↻ reload button on the extensions page for
Chrome to pick up the new files (background service workers are not
hot-reloaded).

### Production build

```bash
npm run build        # vite build
```

Produces an optimised `dist/`. The same folder is what gets loaded as
the unpacked extension.

---

## Local-dev loop (optional FastAPI gateway)

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then edit
python main.py
```

To route the extension through the server instead of hitting Gemini
directly: Settings → **Backend Provider** → *Local FastAPI Server*. The
server's `AUTH_TOKEN` (if set) must match the extension's **Server
Token** in Settings.

### Running the server tests

```bash
cd server
python test_gateway.py          # 9 tests, zero network dependencies
python test_client.py           # agent tool-flow + privacy guard tests
```

Outbound Gemini calls in the gateway tests are mocked via `respx`, so
no API key or network reach is required.

---

## Repo layout — the two conventions worth knowing

### Two privacy trees

The privacy pipeline runs in **two different JavaScript realms** that
cannot share a bundle:

```
src/privacy/        → side-panel realm, bundled with the React app.
src/privacy-page/   → PAGE realm, injected via chrome.scripting.executeScript.
                     Classic scripts. Copied verbatim to dist/privacy/.
```

- Anything that touches the page's live DOM (`detector.js`,
  `contentScript.js`, `coordinateUtils.js`) lives in `src/privacy-page/`.
- Anything that runs in the side panel (OCR, pattern, context, fusion,
  redaction) lives in `src/privacy/` and is imported like any other
  ES module.
- **Why**: Vite can only bundle one of these — the page-realm scripts
  must stay classic scripts because that's what `chrome.scripting.executeScript`
  accepts, and because `coordinateUtils.js` is shared with the side panel
  as a classic `<script>` tag.
- `window.CoordinateUtils` and `window.Tesseract` are the **only
  intentional globals**. Everything else must import directly.

### Debug logging

```js
import { debug, info, warn, error } from './debug.js';
```

- `debug()` / `info()` only fire when `import.meta.env.DEV` is true
  **or** `window.__REDACT_DEBUG = true` is set in the console.
- `warn()` / `error()` always fire.
- Direct `console.log` / `console.debug` in production code is a review
  flag — route it through the facade so the prod extension stays silent.
- Page-realm scripts (`src/privacy-page/*`) can't ES-import the facade.
  Use the local `_dbg` helper pattern already present in `detector.js`.

---

## Invariants (do not break)

These are the project's load-bearing promises. A change that breaks
any of them will not be accepted.

1. **The LLM never sees raw PII values.** Detection records sent to
   the model carry category + confidence + stable ID. Values like the
   actual email address, phone number, SSN digits, OCR text, bounding
   boxes and selectors are stripped by `sanitizeForLLM` in
   `src/agent/llmClient.js` before any outbound call.
2. **The LLM never sees the raw screenshot.** Only the version with
   opaque masks already burned in by `ScreenshotRedactor` leaves the
   browser.
3. **No eval, no dynamic script execution from LLM output.** All tool
   calls go through `ToolValidator` + a static switch in
   `ToolExecutor`. Adding a new tool means registering it in all three
   places; it must not accept raw code strings.
4. **Fail closed on privacy failure.** If `sanitizeCurrentPage` throws,
   the message is dropped — never sent. Agents stop with a clear error
   rather than sending partial state.
5. **Prod console is silent.** Any new `console.log` / `console.debug`
   in a hot path must be routed through `src/debug.js` or an equivalent
   gated helper.

---

## Adding a new agent tool

1. Create `src/agent/tools/<name>.js` exporting `{ execute }`.
2. Add its schema to `src/agent/toolRegistry.js`.
3. Add any argument validation to `src/agent/toolValidator.js`.
4. Add the `case "<name>":` branch to `src/agent/toolExecutor.js`.
5. Update the `src/agent/systemPrompt.md` section describing the tool.
6. If the tool returns a potentially large payload, make sure it fits
   under the 16 KB `MAX_RESULT_JSON_BYTES` cap or that the overage is
   acceptable (it will be truncated).

---

## Pull-request checklist

- `npm run build` succeeds (no TS or Vite errors).
- `python server/test_gateway.py && python server/test_client.py` passes
  if you touched anything under `server/`.
- No new direct `window.*` module globals.
- No new `console.log` outside `debug.js` guards (unless it's a
  `warn`/`error`-level signal that must always fire).
- `grep -rn 'dangerouslySetInnerHTML' src/` returns nothing.
- The Gemini model id is centralised. To bump it:
  - **Client**: edit `src/modelConfig.js` only.
  - **Server**: edit the default in `server/config.py` + `server/.env.example`.
  Verify current ids at [Google AI Studio](https://aistudio.google.com/),
  **not** from an API error body (deprecation errors have been observed
  suggesting fabricated model ids).
- If you touched the manifest, verify `host_permissions` is still
  scoped to http/https (not `<all_urls>`).

---

## Reporting a security issue

If you believe you have found a privacy leak (raw PII reaching Gemini,
unmasked screenshot leaving the browser, unauthenticated server
access), please open a GitHub issue tagged **security** with a minimal
reproduction. For responsible disclosure of anything you consider
high-severity, email the project maintainer directly rather than
filing publicly.
