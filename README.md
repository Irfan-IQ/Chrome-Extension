# 🛡️ Redact Agent

**A privacy-preserving Chrome extension for AI-assisted browsing and on-page redaction.**

Built for **Smart India Hackathon 2026 — SIH26171: On-device Visual Perception for Light-weight Browser Agents**.

[🌐 Install from the Chrome Web Store](https://chromewebstore.google.com/detail/redact-agent/ggcakjfhifadhiehiofjhjllfkijodio)

## 📌 Overview

Redact Agent combines a Chrome side panel, a local privacy pipeline, and an AI assistant to help users inspect web pages and redact sensitive information before sharing page context with an AI model.

The project addresses a central challenge in browser agents: **how can an AI assistant work with visual page context without unnecessarily exposing personal or sensitive information?**

Redact Agent performs page scanning and redaction in the browser. Depending on the selected mode and configuration, it uses Gemini or a self-hosted vision-language model for reasoning.

## ✨ Features

- **Chat Mode** — Ask questions about the current page with a privacy-protected page context.
- **Agent Mode** — Give the agent a task and let it coordinate supported tools through a validated observe–decide–act loop.
- **DOM scanning** — Inspect page elements and detect potentially sensitive information.
- **Local OCR** — Use Tesseract.js to read text from supported visual content, including images and canvas.
- **Vision-based detection** — Use YuNet and OpenCV workers for supported visual detections, including faces.
- **PII detection and fusion** — Combine pattern-based, context-based, DOM, OCR, and vision signals.
- **Screenshot redaction** — Mask detected regions with opaque blocks before a screenshot is shared with an AI model.
- **Agent safeguards** — Validate tool names and parameters before executing supported browser actions.
- **Configurable AI backend** — Use the Gemini Cloud API or a self-hosted model through the optional FastAPI gateway.
- **Built-in assets** — OCR worker, WASM, language data, icons, and the YuNet model are packaged with the extension.

## ⚙️ How it works

1. **Inspect locally:** The extension scans the page DOM and supported visual content.
2. **Detect sensitive regions:** Local detectors identify candidate personal or sensitive information.
3. **Combine detections:** The privacy pipeline fuses detection results and prepares a redacted screenshot.
4. **Reason with AI:** Chat Mode uses the privacy-protected page context; Agent Mode can use stable detection IDs, categories, confidence scores, and safe page metadata to plan its next step.
5. **Execute safely:** Agent tool calls are checked by the extension before supported actions run in the browser.

**Privacy design:** Raw matched values, DOM selectors, bounding-box coordinates, and unredacted screenshot pixels are intended to remain in the local privacy-processing boundary rather than being supplied to the agent's LLM. Chat Mode can send a redacted screenshot and the user's message to the selected AI provider. Review the code and your selected provider's policies before using the extension with sensitive information.

## 🚀 Installation

### Option 1: Chrome Web Store

1. Open the [Redact Agent listing](https://chromewebstore.google.com/detail/redact-agent/ggcakjfhifadhiehiofjhjllfkijodio).
2. Select **Add to Chrome** and confirm the requested permissions.
3. Open the extension from Chrome's Extensions menu or toolbar.
4. Open **Settings** and configure your AI provider.

### Option 2: Build and load from source

#### Prerequisites

- [Node.js](https://nodejs.org/) and npm
- Google Chrome
- A Gemini API key, or a configured self-hosted backend

#### Steps

```bash
git clone https://github.com/Irfan-IQ/Chrome-Extension.git
cd Chrome-Extension
npm install
npm run build
```

Then load the extension into Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project's generated `dist/` directory.
5. Open Redact Agent and configure your AI provider in **Settings**.

After changing the source, run `npm run build` again and reload the extension from `chrome://extensions`.

## 🧠 AI backend configuration

Redact Agent supports Gemini Cloud API and a self-hosted model served through vLLM and the optional FastAPI gateway.

### Option A: Self-hosted Qwen3-VL

This setup uses **Qwen3-VL-30B-A3B-Instruct** with BF16, tool-calling, and multimodal image support. It requires a compatible GPU and enough GPU memory to serve the model.

**1. Start vLLM with Qwen3-VL-30B-A3B-Instruct** (BF16, tool-calling, multimodal):

```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen3-VL-30B-A3B-Instruct \
  --dtype bfloat16 \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.90 \
  --max-num-seqs 64 \
  --max-num-batched-tokens 8192 \
  --tensor-parallel-size 1 \
  --limit-mm-per-prompt image=2 \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \
  --trust-remote-code \
  --port 8001
```

**2. Start the FastAPI gateway** (port `8000`, forwarding requests to vLLM on port `8001`):

Create and activate a virtual environment, then install the gateway dependencies and configure it:

```bash
python -m venv venv
source venv/bin/activate
pip install -r server/requirements.txt
cp server/.env.example server/.env
python server/main.py
```

On Windows, activate the environment with `venv\Scripts\activate` in Command Prompt or `.\venv\Scripts\Activate.ps1` in PowerShell. If your environment uses a different backend configuration, update `server/.env` accordingly.

**3. Configure the extension:**

1. Open Redact Agent's **⚙️ Settings**.
2. Set the backend to **Qwen3-VL 30B-A3B (self-hosted)**.
3. Set **Server Endpoint** to your gateway URL, for example `http://your-dgx-host:8000`.
4. For deployments reachable beyond localhost, set `AUTH_TOKEN` in `server/.env` and enter the same value in **Server Token**.

Keep the vLLM server and FastAPI gateway running while using the self-hosted backend. The example vLLM command is a starting point; adjust GPU memory, parallelism, and other options for your hardware.

### Option B: Gemini Cloud API

1. Create an API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Open Redact Agent's **⚙️ Settings**.
3. Select **Gemini Cloud API** from the backend dropdown.
4. Paste your Gemini API key.

The selected AI provider processes the request data it receives. The extension's local privacy pipeline is designed to redact page screenshots before they are sent.

## 🧰 Technology stack

| Area | Technologies |
|---|---|
| Browser extension | Chrome Extensions Manifest V3, Chrome Side Panel API |
| Frontend | React 18, JavaScript, Vite |
| Local text and page analysis | DOM inspection, JavaScript pattern matching, context analysis |
| OCR | Tesseract.js, WebAssembly |
| Vision | YuNet, OpenCV.js workers, ONNX Runtime Web |
| AI reasoning | Gemini API; self-hosted Qwen3-VL through vLLM |
| Optional gateway | Python, FastAPI, Pydantic, HTTPX |
| Build and packaging | npm, Vite |

## 🗂️ Repository structure

```text
.
├── manifest.json              # Chrome Extension Manifest V3 configuration
├── package.json               # npm scripts and dependencies
├── vite.config.js             # Extension build configuration
├── sidepanel.html             # Side panel entry point
├── src/
│   ├── components/             # Chat, Agent, settings, and UI components
│   ├── agent/                  # Agent loop, tools, validation, and execution
│   ├── privacy/                # OCR, pattern/context analysis, fusion, redaction
│   ├── privacy-page/           # Scripts that inspect the page DOM
│   ├── vision/                 # Vision engine and workers
│   ├── background.js           # Extension service worker
│   └── gemini.js               # AI API client
├── public/
│   ├── icons/                  # Extension icons
│   ├── lib/                    # Tesseract.js and OCR runtime assets
│   └── models/yunet/           # YuNet model assets
├── server/                     # Optional FastAPI model gateway
├── test/                       # Manual test pages and agent test harness
├── vision-model/               # Vision-model experiments and training tools
├── Redact-Agent/               # Static project website and reports
├── docs/
│   ├── ARCHITECTURE.md
│   └── PROBLEM_STATEMENT_AND_AGENT_FLOW.md
├── README.md
└── CONTRIBUTING.md
```

## 🧪 Development commands

```bash
npm install       # Install JavaScript dependencies
npm run build     # Build the extension into dist/
npm run preview   # Preview the Vite build locally
npm run package   # Build and create redact-agent.zip for Chrome Web Store packaging
```

`npm run package` packages the contents of `dist/` with `manifest.json` at the archive root. Upload the generated `redact-agent.zip` to the Chrome Web Store when preparing a release.

The repository also contains a browser-based agent test harness at `test/agent-test.html` and Python gateway tests under `server/`. Run the gateway tests from an environment with the server dependencies installed:

```bash
python -m pytest server/
```

## 📚 Documentation

For contribution guidelines, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

For the system design and component interactions, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
