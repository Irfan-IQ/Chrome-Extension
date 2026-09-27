# Redact Agent — Architecture

> Merged from the earlier `ARCHITECTURE.md` (system view) and `AGENT_ARCHITECTURE.md` (agent-layer view).
> Update this doc as the codebase evolves; delete anything that stops being true.

## 1. Overview

Redact Agent is a Chrome Extension (Manifest V3) that combines a Gemini-powered chatbot (**Chat Mode**) with a genuine tool-calling LLM agent (**Agent Mode**) for automated, privacy-first page redaction.

Separation of concerns:

| Component          | Responsibility                                       |
|--------------------|------------------------------------------------------|
| **LLM (Gemini)**   | Plan, reason, decide which tool to call next         |
| **Validator**      | Security boundary — rejects invalid LLM output       |
| **Executor**       | Routes validated calls to trusted extension code     |
| **Privacy Engine** | Deterministic local PII detection + redaction        |
| **Browser**        | Provides the live page environment                   |

```
┌───────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                           │
│                                                                   │
│  ┌──────────────────┐          ┌──────────────────────────────┐   │
│  │   Chat Mode      │          │        Agent Mode            │   │
│  │  (Gemini + UI)   │          │  (LLM Tool-Calling Agent)    │   │
│  │  gemini.js       │          │  agent/agentManager.js       │   │
│  │  React sidepanel │          │  agent/llmClient.js          │   │
│  └────────┬─────────┘          └──────────┬───────────────────┘   │
│           └────────────┬──────────────────┘                       │
│                        ▼                                          │
│              ┌──────────────────┐                                 │
│              │  Privacy Engine  │  (local, deterministic)         │
│              │  privacy/*.js    │                                 │
│              └──────────────────┘                                 │
│                        │                                          │
│               Content Script Bridge                               │
│               privacy/contentScript.js                            │
└────────────────────────┼──────────────────────────────────────────┘
                         │ chrome.tabs.sendMessage
                         ▼
                  Active Browser Tab
```

## 2. Repository Layout

```
Chrome-Extension/
├── manifest.json              MV3 config
├── background.js              Service worker (opens side panel)
├── sidepanel.html             Side panel entry point
├── sidepanel.css              Styles
├── gemini.js                  Gemini REST client (Chat mode)
│
├── src/                       React sidepanel (Vite build)
│   ├── main.jsx, App.jsx, utils.js
│   ├── components/            Header, ChatMode, AgentMode, SettingsPanel, ZoomLightbox
│   └── vision/                YuNet + OpenCV workers, visionEngine.js
│
├── privacy/                   Local privacy pipeline
│   ├── contentScript.js       Injected bridge — responds to PRIVACY_SCAN
│   ├── detector.js            DOM-based PII detection
│   ├── coordinateUtils.js     CSS ↔ screenshot coordinate mapping
│   ├── ocrAnalyzer.js         Tesseract.js OCR wrapper
│   ├── patternAnalyzer.js     Regex PII classifier
│   ├── contextAnalyzer.js     NER + label→value inference
│   ├── detectionFusion.js     Merges DOM + OCR detections
│   ├── screenshotRedactor.js  OffscreenCanvas PII masking
│   └── privacyEngine.js       Full pipeline (used by Chat mode)
│
├── agent/                     Agent layer
│   ├── agentState.js          Session state + detection ID registry
│   ├── toolRegistry.js        Allowed-tool definitions (Gemini schema)
│   ├── toolValidator.js       Security boundary — validates LLM output
│   ├── toolExecutor.js        Static dispatcher → tool implementations
│   ├── llmClient.js           Gemini function-calling API wrapper
│   ├── agentManager.js        Main agent loop (Observe → Decide → Act)
│   └── tools/                 scanDom, screenshot, scanOcr, fuseDetections,
│                              redact, verifyRedaction, getPageContext,
│                              clickElement, navigateTo, openTab
│
├── lib/                       Bundled OCR runtime (tesseract, wasm, traineddata)
├── icons/                     Extension icons
├── public/models/yunet/       ONNX face-detection model
└── docs/                      This document + future architecture notes
```

## 3. Data Flow — Chat Mode

```
User types message
    │
    ▼
privacyEngine.sanitizeCurrentPage()   ← if Privacy Protection: ON
    │
    ├── inject contentScript into tab
    ├── PRIVACY_SCAN → detector.js → DOM detections
    ├── captureVisibleTab → raw screenshot
    ├── OcrAnalyzer → OCR words
    ├── PatternAnalyzer + ContextAnalyzer → classified detections
    ├── DetectionFusion → fused detections
    └── ScreenshotRedactor → redacted screenshot (OffscreenCanvas)
                │
                ▼
Gemini.sendMessage(message, history, {
    imageDataUrl: redactedScreenshot,  ← NEVER raw screenshot
    pageContext:  safeMetadata          ← NEVER raw PII
})
    │
    ▼
Gemini API response → displayed in chat
```

## 4. Data Flow — Agent Mode

```
User request → AgentManager.run(task)
    │
    ▼
AgentLLMClient.generateWithTools(messages, tools)
    │
    ├── [Gemini returns tool_call] ─────────────────────┐
    │                                                   │
    │   ToolValidator.validate(toolCall)                │
    │       ↓ invalid → function_response error         │
    │       ↓ valid                                     │
    │   ToolExecutor.execute(toolCall)                  │
    │       ↓                                           │
    │   [Tool runs — see Privacy Engine]                │
    │       ↓                                           │
    │   Result sanitized (strip raw values)             │
    │       ↓                                           │
    │   Append function_response to messages            │
    │       ↓                                           │
    └── AgentLLMClient.generateWithTools(messages) ◄────┘
    │
    └── [Gemini returns text] → Task complete → summary
```

Loop bounded by:
- `MAX_AGENT_STEPS = 10` — absolute step limit
- `MAX_SAME_TOOL_IN_A_ROW = 2` — prevents infinite tool repetition

### Available Tools

| Tool                | Description                                              |
|---------------------|----------------------------------------------------------|
| `scan_dom`          | Detect PII in the DOM via local rules                    |
| `take_screenshot`   | Capture the active tab (stored locally)                  |
| `scan_ocr`          | Detect PII in images/canvas via local OCR                |
| `fuse_detections`   | Merge DOM + OCR; assign stable detection IDs             |
| `redact`            | Paint opaque blocks over detection regions               |
| `verify_redaction`  | Confirm all detections have been masked                  |
| `get_page_context`  | Return hostname, title, viewport (safe metadata)         |
| `click_element`     | Click a validated on-page element                        |
| `navigate_to`       | Navigate the active tab to a validated URL               |
| `open_tab`          | Open a validated URL in a new tab                        |

## 5. Privacy Design

At no point does raw PII flow to Gemini:

```
DOM detection                  OCR detection
{ matchedText: "user@x.com"   { text: "555-1234"
  rect: {x,y,w,h}               rect: {x,y,w,h}
  selector: ".email-field"      confidence: 0.82
  confidence: 0.91 }            category: "phone" }
         │                              │
         └──────────── fuse ────────────┘
                          │
                    AgentState.assignDetectionIds()
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
  Sent to LLM (safe)              Kept local (sensitive)
  [                               detectionMap internals:
    { id: "det_0",                  matchedText, rect,
      category: "email",            selector, _el
      confidence: 0.91,
      sources: ["dom"] },
    { id: "det_1",
      category: "phone",
      confidence: 0.82,
      sources: ["ocr"] }
  ]
```

### What the LLM sees vs. what stays local

| Data                                 | LLM sees? | Stays local? |
|--------------------------------------|-----------|--------------|
| Detection IDs (`det_0`, `det_1`, …)  | ✓         |              |
| Category labels (`email`, `phone`)   | ✓         |              |
| Confidence scores (0.0–1.0)          | ✓         |              |
| Source labels (`dom`, `ocr`)         | ✓         |              |
| Bounding-box coordinates             | ✗         | ✓            |
| Raw matched text values              | ✗         | ✓            |
| DOM element selectors                | ✗         | ✓            |
| Raw screenshot pixels                | ✗         | ✓            |
| Redacted screenshot                  | ✗         | ✓            |

The LLM **instructs** but never **sees** the sensitive data.

## 6. Security Boundaries

**ToolValidator is the single enforcement point.** Every LLM-generated tool call passes through `ToolValidator.validate()` before execution:

```
LLM output          ToolValidator checks             Allowed?
──────────────────  ──────────────────────────────   ────────
{name:"scan_dom"}   name ∈ ALLOWED_TOOLS             YES
{name:"eval"}       name ∉ ALLOWED_TOOLS             NO  ✗
{name:42}           typeof name !== "string"         NO  ✗
null                toolCall is not an object        NO  ✗
{name:"redact",     detectionIds is array            YES
 args:{
   detectionIds:    each ID matches /^det_\d+$/      YES
   ["det_0"],       method ∈ ALLOWED_METHODS         YES
   method:"MASK"}}
{name:"redact",     CSS selector format rejected     NO  ✗
 args:{
   detectionIds:
   ["#password"],
   method:"MASK"}}
```

**ToolExecutor uses static dispatch only:**

```javascript
switch (toolCall.name) {
  case "scan_dom":        return ScanDom.execute(state, tabId);
  case "take_screenshot": return Screenshot.execute(state, tabId);
  // …
  default: throw new Error("Unknown tool: " + toolCall.name);
}
```

`chrome.scripting.executeScript` is called **only** with hardcoded extension file paths — never with LLM-generated script content.

### Never allowed

- `eval` or `Function()` with LLM-generated code
- `chrome.scripting.executeScript` with arbitrary scripts
- Unrestricted URL or DOM selector access from LLM output
- Raw PII values in the conversation history
- LLM-chosen network requests

Enforced via `ToolRegistry.ALLOWED_TOOLS`, `ToolValidator.validate()`, and the static switch in `ToolExecutor`.

## 7. Key Libraries

| Library         | Version           | Purpose                        | Loaded from                        |
|-----------------|-------------------|--------------------------------|------------------------------------|
| React           | 18.x              | Sidepanel UI                   | Vite bundle                        |
| Tesseract.js    | 4.x               | In-browser OCR                 | `lib/tesseract.min.js` (bundled)   |
| onnxruntime-web | 1.x               | YuNet face detection           | npm dep, imported from `src/`      |
| @opencvjs/worker| 5.x               | Vision preprocessing           | npm dep, imported from `src/`      |
| Gemini API      | 2.0-flash         | LLM reasoning + function calls | REST (fetch)                       |
| OffscreenCanvas | browser built-in  | Screenshot redaction           | —                                  |

## 8. Extension Permissions

| Permission     | Why                                            |
|----------------|------------------------------------------------|
| `sidePanel`    | Side panel UI                                  |
| `storage`      | Store API key locally                          |
| `activeTab`    | Access the current tab                         |
| `scripting`    | Inject `contentScript` for DOM scanning        |
| `tabs`         | Capture screenshot for redaction               |

Host permissions: `<all_urls>` — required so injected content scripts can scan any page the user opens the side panel on.

## 9. Typical Demo Flow

**User:** "Redact all personal information on this page."

```
Step 1  scan_dom          → Found 5 DOM detections (2 email, 2 name, 1 phone)
Step 2  take_screenshot   → Captured 1440×900 px
Step 3  scan_ocr          → OCR: 312 words, 3 detections (1 email, 2 phone)
Step 4  fuse_detections   → Fused to 7 unique detections (det_0 … det_6)
Step 5  redact            → Redacted 7 regions using MASK
Step 6  verify_redaction  → ✓ All 7 regions masked
Step 7  [LLM text]        → Task complete.
```

## 10. Failure Handling

| Failure                                    | Agent response                                                     |
|--------------------------------------------|--------------------------------------------------------------------|
| OCR fails                                  | Skip OCR; run `fuse_detections` on DOM-only results                |
| `scan_dom` finds 0 detections              | LLM calls `get_page_context`, may attempt OCR                      |
| `redact` fails                             | Return error; LLM can retry once or report to user                 |
| Same tool called >2 times consecutively    | Loop protection triggers; agent stops safely                       |
| LLM exceeds `MAX_AGENT_STEPS` (10)         | Agent stops; user sees partial result                              |
| API key missing                            | Immediate clear error before agent starts                          |

## 11. Observability

The agent emits a step log entry for every action:

```js
{
  step:      3,
  tool:      "scan_ocr",
  status:    "success",       // "success" | "error" | "working" | "rejected"
  message:   "OCR: 312 words, 3 detections — 1 email, 2 phone.",
  duration:  4821,            // ms
  timestamp: 1720000000000
}
```

**Never logged:** raw PII values, raw screenshot data, DOM element content.

## 12. Adding a New Tool

1. Create `agent/tools/myTool.js`.
2. Add the tool name to `ALLOWED_TOOLS` in `toolRegistry.js`.
3. Add a `functionDeclarations` entry in `toolRegistry.js`.
4. Add a `case` in `toolValidator.js → validateParams()` if it takes parameters.
5. Add a `case` in `toolExecutor.js → execute()`.
6. Load the script in `sidepanel.html` before `toolExecutor.js` (until the ESM migration lands — then just `import` it).
