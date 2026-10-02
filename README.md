# Redact Agent — Chrome Extension (V4)

A Chrome Manifest V3 extension that combines a Gemini-powered **privacy chatbot** (Chat Mode) with a genuine **LLM tool-calling agent** (Agent Mode) for automated, privacy-first page redaction.

Built for **Smart India Hackathon**.

---

## What's New in V4: Agent Mode

Agent Mode upgrades the extension from a simple chatbot into a proper agentic system:

```
User → AgentManager → LLM → Tool Call → Validator → Executor → Privacy Engine → Result → LLM → ...
```

The LLM (Gemini) **plans and decides** which tools to call. The extension **executes them locally**. Raw PII never reaches the LLM.

---

## Features

### Chat Mode (original)
- Gemini-powered chatbot in Chrome's side panel
- Privacy protection: automatically scans the current page before sending each message
- DOM scan, OCR (Tesseract.js), pattern + context analysis, detection fusion
- Redacted screenshot sent to Gemini — raw screenshot stays local
- Before/after screenshot comparison with detection summary

### Agent Mode (new in V4)
- LLM-driven agent that orchestrates the privacy pipeline step by step
- Gemini native function calling — structured, validated, not free-form text parsing
- Live step log: see the agent's Observe → Decide → Act cycle in real time
- Quick-task shortcuts: "Redact all PII", "Scan & Report", "Emails & Phones"
- Redacted screenshot displayed after the agent completes
- Security boundary: every LLM tool call is validated before execution

---

## Privacy Model

> **The LLM never sees raw PII. The LLM never sees the raw screenshot.**

| Data | LLM sees? | Stays local? |
|------|-----------|--------------|
| Detection IDs (`det_0`, `det_1`, …) | ✓ | |
| Category labels (`email`, `phone`) | ✓ | |
| Confidence scores | ✓ | |
| Matched text values | ✗ | ✓ |
| Bounding-box coordinates | ✗ | ✓ |
| DOM element selectors | ✗ | ✓ |
| Raw screenshot pixels | ✗ | ✓ |

The agent uses stable detection IDs to reference specific detections without ever seeing the actual data.

---

## Installation

1. Clone or download this repository.
2. Run `npm install && npm run build` to produce `dist/`.
3. Open Chrome and go to `chrome://extensions/`.
4. Enable **Developer mode** (top right).
5. Click **Load unpacked** and select the **`dist/`** folder (not the project root).
6. Click the extension icon → the side panel opens.
7. Click ⚙ Settings and paste your [Gemini API key](https://aistudio.google.com/app/apikey).

### Publishing to the Chrome Web Store

```bash
npm run package
```

Writes `redact-agent.zip` containing the contents of `dist/` with
`manifest.json` at the archive root — the exact shape the Chrome Web Store
expects. Do **not** zip the project root: it contains a second `manifest.json`
at `./manifest.json` and the Web Store rejects multi-manifest packages
(*"More than one manifest found in package"*).

### Optional: Local Server (Only if hosting a local LLM/VLM)
1. Create and activate a Python virtual environment (`python -m venv venv`).
2. Install dependencies: `pip install -r server/requirements.txt`.
3. Copy environment template: `copy server\.env.example server\.env` (or `cp server/.env.example server/.env`).
4. Set `BACKEND_MODE=local_vlm` in `server/.env`.
5. Start the server: `python server/main.py`.

---


## Usage

### Chat Mode

1. Navigate to any page.
2. Ensure **Privacy Protection: ON** in the side panel.
3. Click **🛡 Scan Page** to see what the privacy engine detects.
4. Type a message — the redacted screenshot is automatically attached.

### Agent Mode

1. Click the **🤖 Agent** tab in the header.
2. Type a privacy task or click a quick-task button.
3. Click **▶ Run**.
4. Watch the agent plan and execute each step in real time.
5. After completion, review the redacted screenshot and agent summary.

**Example tasks:**
- "Redact all personal information on this page"
- "Find and redact all email addresses and phone numbers"
- "Scan this page for sensitive data and report what you find"

---

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system architecture (merged system + agent-layer view, including the security model and how to add new tools).

See [`docs/PROBLEM_STATEMENT_AND_AGENT_FLOW.md`](docs/PROBLEM_STATEMENT_AND_AGENT_FLOW.md) for the problem-statement framing and a step-by-step agent-execution flow.

See [`CHANGELOG.md`](CHANGELOG.md) for the version history and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the local-dev loop and the two-realm privacy-tree convention.

### Agent Tools

The LLM may call **only** these predefined tools:

| Tool | Description |
|------|-------------|
| `scan_dom` | Detect PII in the DOM using local pattern rules |
| `take_screenshot` | Capture the active tab (stored locally) |
| `scan_ocr` | Detect PII in images/canvas via local OCR |
| `fuse_detections` | Merge DOM + OCR results; assign stable detection IDs |
| `redact` | Paint opaque blocks over detected regions |
| `verify_redaction` | Confirm all detections have been masked |
| `get_page_context` | Return safe page metadata (host, title, viewport) |

### Security Model

- **ToolValidator** — allowlist check + type + parameter validation on every LLM tool call
- **ToolExecutor** — static `switch/case`, no dynamic dispatch
- `chrome.scripting.executeScript` is called only with hardcoded extension files, never with LLM-generated code
- Loop protection: `MAX_AGENT_STEPS = 10`, `MAX_SAME_TOOL_IN_A_ROW = 2`

---

## Privacy Pipeline (Local, Deterministic)

```
DOM scan (detector.js)
    +
Screenshot → OCR (Tesseract.js)
    +
Pattern analysis (regex) + Context/NER analysis
    ↓
Detection Fusion (IoU + confidence scoring)
    ↓
ScreenshotRedactor (OffscreenCanvas — opaque blocks)
```

All processing runs **inside the Chrome extension**. No raw data is sent to any server.

---

## File Structure

```
├── manifest.json
├── vite.config.js
├── sidepanel.html
│
├── src/
│   ├── App.jsx, main.jsx       React side-panel entry
│   ├── background.js           MV3 service worker
│   ├── gemini.js               Gemini REST client (Chat mode)
│   ├── sidepanel.css
│   ├── utils.js
│   │
│   ├── components/             React UI (Header, Chat, Agent, Settings, …)
│   │
│   ├── privacy/                SIDE-PANEL realm — bundled with the React app
│   │   ├── privacyEngine.js    public entry point
│   │   ├── ocrAnalyzer.js
│   │   ├── patternAnalyzer.js
│   │   ├── contextAnalyzer.js
│   │   ├── detectionFusion.js
│   │   └── screenshotRedactor.js
│   │
│   ├── privacy-page/           PAGE realm — injected via chrome.scripting
│   │   ├── contentScript.js    (copied verbatim to dist/privacy/ at build time)
│   │   ├── detector.js
│   │   └── coordinateUtils.js
│   │
│   ├── vision/                 YuNet + OpenCV workers (face / card candidates)
│   │
│   └── agent/                  Agent layer (V4)
│       ├── agentState.js
│       ├── toolRegistry.js
│       ├── toolValidator.js
│       ├── toolExecutor.js
│       ├── llmClient.js
│       ├── agentManager.js
│       └── tools/
│           ├── scanDom.js, screenshot.js, scanOcr.js, fuseDetections.js,
│           ├── redact.js, verifyRedaction.js, getPageContext.js,
│           └── clickElement.js, navigateTo.js, openTab.js
│
├── server/                     FastAPI backend (optional for local LLM)
│   ├── config.py
│   ├── main.py
│   ├── schemas.py
│   └── requirements.txt
│
├── lib/
│   └── tesseract.min.js        Bundled OCR engine (no CDN)
│
├── test/
│   └── agent-test.html         Unit tests (35+ cases, no API key needed)
│
├── docs/
│   ├── ARCHITECTURE.md             Merged system + agent architecture
│   └── PROBLEM_STATEMENT_AND_AGENT_FLOW.md
├── Redact-Agent/                   Separate static landing site (Vercel-hosted)
├── CHANGELOG.md
└── CONTRIBUTING.md
```

---

## Running the Tests

Open `test/agent-test.html` as a local file in Chrome (or serve it from the extension context). The tests cover:

- ToolRegistry — allowlist, definitions, dangerous ops blocked
- ToolValidator — valid calls, security rejections, redact parameter validation
- AgentState — detection ID assignment, metadata privacy, ID resolution

No API key or network access required.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension platform | Chrome MV3, side panel |
| LLM | Google Gemini 2.0 Flash (function calling) |
| OCR | Tesseract.js v4 (LSTM, fully local) |
| Screenshot redaction | OffscreenCanvas (fully local) |
| Language | Vanilla JavaScript (no build step, no framework) |

---

## Hackathon Notes

- All PII detection and redaction runs **100% locally** — no external services except the Gemini API for reasoning.
- The Gemini API receives only: the user's task text, safe page metadata, and detection IDs/categories — never raw PII or the raw screenshot.
- The agent architecture demonstrates a real **Observe → Decide → Act** loop with native function calling, not prompt engineering tricks.
`public/models/yunet/face_detection_yunet_2023mar.onnx`

The current repository ZIP does not contain the ONNX weights. The detector code alone is not enough to load the model. Obtain the official YuNet weight from OpenCV Zoo and place it at the path above before building. OpenCV Zoo lists `face_detection_yunet_2023mar.onnx` in its face detection model directory and documents the model as MIT licensed. 
