# SIH26171 — On-device Visual Perception for Light-weight Browser Agents

> How Redact Agent maps to the problem statement, and what actually happens inside the agent when you give it a task.

---

## 1. The Problem Statement (SIH26171)

**Title:** On-device Visual Perception for Light-weight Browser Agents

### Background
Agentic AI is becoming pervasive in day-to-day digital work. If such an agent had access to the user's **visual context and screen state**, it could automate complex workflows. But most agent pipelines run **server-side**, which forces users to ship potentially sensitive screen data over the network. Running the agent **locally in the browser** removes that constraint — the machine does the perception, and only non-sensitive structure is ever transmitted.

Modern browser primitives — **WebGPU**, **WebAssembly**, **ONNX Runtime Web**, **Transformers.js** — now make it practical to run lightweight vision models directly on the client. The goal is to bridge two environments: **cloud-side reasoning power** with **client-side data privacy**.

### Description
Build a **privacy-preserving vision agent that runs in the browser**. A local Vision Transformer (or equivalent CV model) "reads" the user's screen and decides what to do. If any visual context must reach the server, the client **sanitizes PII first** — using DOM tags, bounding-box redaction, or any equivalent method — so that only anonymized, unidentifiable data is transmitted. Examples: blurring faces, blacking out passwords, masking PII. The server, aware of the redaction scheme, processes the sanitized context and returns actionable commands (e.g. *"click the submit button"*, *"scroll down"*) that the client executes. The team must balance **inference latency vs. accuracy**.

### Expected Solution
A working prototype with:

**Client-side (browser extension / JS):**
- **Local vision processing** — a vision model running in-browser (e.g. via WebGPU) that evaluates the current screen state.
- **Privacy-preserving filter** — local bounding-box redaction, semantic obfuscation, or masking of sensitive visual regions before anything leaves the machine.

**Server-side:**
- Receives the **anonymized** visual context, runs an LLM/VLM (any offline-deployable, open-weights model; cloud-hosted versions allowed during SIH), and returns either processed data or a UI action for the client to execute.
- **An end-to-end user-assist task** must be demonstrated.

### Evaluation Metrics
| Weight | Metric |
|-------:|--------|
| 25% | Accuracy of visual context extracted from the screen |
| 20% | Recall / precision of sensitive/PII detection |
| 20% | Precision of redaction |
| 20% | Client-side resource utilization |
| 15% | Overall end-to-end latency of the demonstrated task |

---

## 2. How Redact Agent Solves It

The extension is a Chrome MV3 side panel that combines:

| Layer | Purpose | Where it runs |
|------|---------|---------------|
| **Local perception** | Read the current page — DOM scan, screenshot, in-browser OCR (Tesseract.js WASM), face/PII vision (YuNet + OpenCV via ONNX Runtime Web workers) | 100% in-browser |
| **Local privacy engine** | Pattern + context analysis, DOM/OCR/vision fusion, opaque-block redaction over an `OffscreenCanvas` | 100% in-browser |
| **Remote reasoning (LLM)** | Gemini (or a local VLM via the optional FastAPI server). Sees **only** detection IDs, categories, confidence scores, and safe page metadata — never raw PII, never raw pixels | Cloud (or local server) |
| **Executor** | Runs the LLM's tool calls in the browser after they pass a strict validator | In-browser (privileged extension context) |

**Data-flow guarantee — the LLM never sees:**
- raw text values matched by the detectors,
- bounding-box coordinates,
- DOM element selectors,
- raw screenshot pixels.

**The LLM only ever sees:**
- the user's task text,
- stable detection IDs (`det_0`, `det_1`, …),
- category labels (`email`, `phone`, `face`, …),
- confidence scores and count summaries,
- safe page context (host, title, viewport).

This is how the extension maps directly onto the problem statement's split of *local perception* + *local redaction* + *remote reasoning over anonymized context*.

---

## 3. End-to-End: What Happens When You Give the Agent a Task

The loop lives in [`src/agent/agentManager.js`](../src/agent/agentManager.js) and follows a classic **Reason → Act → Observe** cycle, capped at `MAX_AGENT_STEPS = 15` with a same-tool-in-a-row guard of 2.

### 3.1 The seven tools the LLM may call

| Tool | Purpose | Sends anything to the LLM? |
|------|---------|----------------------------|
| `get_page_context` | Return host, title, viewport | Yes — safe metadata only |
| `scan_dom` | Pattern + context PII detection over DOM text | Detection counts + categories only |
| `take_screenshot` | Capture active tab into local memory | Dimensions only — pixels stay local |
| `scan_ocr` | Run Tesseract.js WASM over the screenshot | Word count + detection counts |
| `fuse_detections` | Merge DOM + OCR + vision results, assign stable IDs, run YuNet face detection | List of `det_N` IDs + categories/confidences |
| `redact` | Paint opaque blocks over regions on an `OffscreenCanvas` | Count of regions masked |
| `verify_redaction` | Re-scan to confirm nothing sensitive remains | Boolean + remaining count |
| `click_element`, `navigate_to`, `open_tab` | Browser actions | Success/failure only |

Every one of these executes **inside the extension**. The LLM cannot inject code — it can only pick a tool name from this list and supply parameters that match the schema.

### 3.2 The loop, step by step

```
                       ┌──────────────────────────────────┐
   User task ─────────▶│ 1. AgentManager.run()            │
                       │    seeds messages with user text │
                       └───────────────┬──────────────────┘
                                       ▼
              ┌─────────────────────────────────────────────┐
              │ 2. AgentLLMClient.generateWithTools()       │
              │    Sends conversation + tool schema         │
              │    + system prompt to Gemini                │
              └───────────────┬─────────────────────────────┘
                              ▼
                      ┌───────────────┐        text ──▶ 7. Done, return summary
                      │ LLM response? │
                      └───────┬───────┘
                              │ tool_call
                              ▼
              ┌─────────────────────────────────────────────┐
              │ 3. ToolValidator.validate()                 │
              │    Allowlist + type + param checks          │
              └───────────────┬─────────────────────────────┘
                    invalid  │valid
              ┌──────────────┤
              │ push          │
              │ validation    ▼
              │ error   ┌──────────────────────────────────┐
              │ back    │ 4. Loop guard: consecutive-tool  │
              │ to LLM  │    counter, MAX_SAME_IN_A_ROW=2  │
              │         └───────────────┬──────────────────┘
              │                         ▼
              │         ┌──────────────────────────────────┐
              │         │ 5. ToolExecutor.execute()        │
              │         │    Static switch → tool module   │
              │         │    Runs LOCAL work in extension  │
              │         └───────────────┬──────────────────┘
              │                         ▼
              │         ┌──────────────────────────────────┐
              │         │ 6. Sanitize result, push as      │
              │         │    functionResponse back into    │
              │         │    the conversation              │
              │         └───────────────┬──────────────────┘
              │                         │
              └─────────────────────────┴──▶ back to step 2
```

Each turn:
1. **Reason** — LLM sees the running transcript and picks the next tool.
2. **Validate** — [`ToolValidator`](../src/agent/toolValidator.js) rejects unknown tools, wrong types, malformed IDs (`det_N`), disallowed redaction methods, non-http URLs, oversized strings.
3. **Guard** — a counter blocks the same tool from firing 3+ times in a row without progress.
4. **Act** — [`ToolExecutor`](../src/agent/toolExecutor.js) routes via a hardcoded `switch` (no dynamic dispatch, no `eval`) to the matching module under [`src/agent/tools/`](../src/agent/tools).
5. **Observe** — the tool returns a **sanitized** result: counts, categories, IDs — never raw PII. The result is added to the conversation as a `functionResponse`.
6. **Stop** — when the LLM returns a plain text message (no tool call), that's the final summary. Otherwise the loop caps at 15 steps.

### 3.3 A concrete walk-through

**User task:** *"Redact all personal information on this page."*

| # | LLM decides | What runs locally | What the LLM is told back |
|--:|-------------|-------------------|---------------------------|
| 1 | `scan_dom` | Pattern + context analyzers walk the DOM text; regex + heuristics assign confidences | `{ detectionCount: 12, categorySummary: { email: 4, phone: 3, name: 5 } }` |
| 2 | `take_screenshot` | `chrome.tabs.captureVisibleTab` → stored in `AgentState` — never leaves the extension | `{ width: 1440, height: 900 }` |
| 3 | `scan_ocr` | Tesseract.js WASM runs on the screenshot; extracted words go through the same pattern/context analyzers | `{ ocrWordCount: 318, detectionCount: 4, categorySummary: { email: 1, phone: 1, cardNumber: 2 } }` |
| 4 | `fuse_detections` | IoU-based deduplication across DOM + OCR + YuNet face detections (ONNX Runtime Web worker); each surviving detection gets a stable `det_N` ID | `{ totalDetections: 14, categorySummary: {...}, ids: ["det_0", ..., "det_13"], visionEnabled: true }` |
| 5 | `redact` (ids: all 14, method: `"opaque"`) | `ScreenshotRedactor` paints black rectangles onto an `OffscreenCanvas` for each detection's bbox; result stored as the redacted screenshot | `{ redactedCount: 14 }` |
| 6 | `verify_redaction` | Re-scan the redacted image to confirm nothing sensitive is still visible | `{ verified: true, remainingCount: 0 }` |
| 7 | *text response* | — | *"Done — 14 items redacted: 5 names, 5 emails, 3 phone numbers, 2 card numbers, 1 face. No sensitive data remains visible."* |

The user sees a live "Observe → Decide → Act" log in the side panel, plus the redacted screenshot at the end.

**User task (browser action):** *"Open the Repositories tab on this GitHub profile."*

| # | LLM decides | What runs locally | LLM sees back |
|--:|-------------|-------------------|---------------|
| 1 | `click_element(text: "Repositories")` | Content script finds a visible element by accessible label and clicks it | `{ success: true, matchedBy: "text" }` |
| 2 | *text response* | — | *"Clicked the Repositories tab."* |

If step 1 had returned `NOT_FOUND`, the LLM's system prompt tells it to fall back to `get_page_context` → `navigate_to(url)`.

### 3.4 Where the SIH26171 requirements are met

| Requirement | Where it lives |
|---|---|
| Local vision processing in-browser (WebGPU/WASM) | [`src/vision/yunet.worker.ts`](../src/vision/yunet.worker.ts), [`src/vision/opencv.worker.ts`](../src/vision/opencv.worker.ts), [`src/privacy/ocrAnalyzer.js`](../src/privacy/ocrAnalyzer.js) (Tesseract.js WASM) |
| Privacy-preserving filter (bounding-box redaction on the client) | [`src/privacy/screenshotRedactor.js`](../src/privacy/screenshotRedactor.js), [`src/privacy/detectionFusion.js`](../src/privacy/detectionFusion.js) |
| Only anonymized context reaches the server | [`src/agent/llmClient.js`](../src/agent/llmClient.js), sanitized `functionResponse` payloads in [`src/agent/agentManager.js`](../src/agent/agentManager.js) |
| Server returns actionable commands the client executes | Tool-calling loop in [`src/agent/agentManager.js`](../src/agent/agentManager.js) + optional local VLM backend in [`server/`](../server) |
| End-to-end user-assist demo | Quick-task buttons in [`src/components/AgentMode.jsx`](../src/components/AgentMode.jsx); demo page at [`test/pii-test-page.html`](../test/pii-test-page.html) |

### 3.5 How the design targets each evaluation metric

| Metric | Design choice |
|---|---|
| **Visual context accuracy (25%)** | Multi-signal fusion — DOM parse + OCR + YuNet — gives coverage across text, canvas, and image regions rather than relying on OCR alone. |
| **PII detection recall/precision (20%)** | Regex patterns *and* context analysis (proximity to labels like "email:", "phone"); NER-style scoring in [`contextAnalyzer.js`](../src/privacy/contextAnalyzer.js) reduces false positives. |
| **Redaction precision (20%)** | Detections carry bounding boxes from the source (DOM rect or OCR word geometry); `screenshotRedactor` paints an opaque block per box on an `OffscreenCanvas`, and `verify_redaction` re-scans to prove nothing leaked through. |
| **Client resource utilization (20%)** | Vision + OCR run in dedicated **Web Workers** (`yunet.worker.ts`, `opencv.worker.ts`) to keep the side panel responsive; models load lazily on first use. |
| **End-to-end latency (15%)** | Loop hard-caps at 15 steps with a same-tool guard; low `temperature: 0.1` reduces reasoning drift; only summary metadata (not pixels) is sent per turn. |

---

## 4. Quick reference

- **Entry point of the loop:** [`AgentManager.run()`](../src/agent/agentManager.js) called from [`src/components/AgentMode.jsx`](../src/components/AgentMode.jsx).
- **Security boundary:** every LLM tool call → [`ToolValidator.validate()`](../src/agent/toolValidator.js) → allowlist + typed param check.
- **Sanitization boundary:** tool results → [`AgentLLMClient.buildFunctionResponseMessage()`](../src/agent/llmClient.js) → only IDs, counts, and category labels reach the next LLM turn.
- **Full architecture diagram:** [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
