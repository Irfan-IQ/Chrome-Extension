# Redact Agent — System Architecture

## Overview

Redact Agent is a Chrome Extension (Manifest V3) that combines a traditional AI chatbot (Chat Mode) with a genuine **tool-calling AI agent** (Agent Mode) for automated, privacy-first page redaction.

```
┌───────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                           │
│                                                                   │
│  ┌──────────────────┐          ┌──────────────────────────────┐   │
│  │   Chat Mode       │          │        Agent Mode            │   │
│  │  (Gemini + UI)   │          │  (LLM Tool-Calling Agent)    │   │
│  │  gemini.js        │          │  agent/agentManager.js       │   │
│  │  sidepanel.js     │          │  agent/llmClient.js          │   │
│  └────────┬─────────┘          └──────────┬───────────────────┘   │
│           │                               │                        │
│           └────────────┬──────────────────┘                       │
│                        ▼                                          │
│              ┌──────────────────┐                                 │
│              │  Privacy Engine  │  (local, deterministic)         │
│              │  privacy/*.js    │                                  │
│              └──────────────────┘                                 │
│                        │                                          │
│               Content Script Bridge                               │
│               privacy/contentScript.js                            │
│                        │                                          │
└────────────────────────┼──────────────────────────────────────────┘
                         │ chrome.tabs.sendMessage
                         ▼
                  Active Browser Tab
```

---

## Manifest V3 Structure

```
Chrome Extension
├── manifest.json              MV3 config
├── background.js              Service worker (minimal — opens side panel)
├── sidepanel.html             Side panel entry point
├── sidepanel.css              Styles
├── sidepanel.js               Chat mode + Agent mode UI controller
├── gemini.js                  Gemini REST client (Chat mode)
│
├── privacy/                   Local privacy pipeline (unchanged in V4)
│   ├── contentScript.js       Injected bridge — responds to PRIVACY_SCAN
│   ├── detector.js            DOM-based PII detection
│   ├── coordinateUtils.js     CSS ↔ screenshot coordinate mapping
│   ├── ocrAnalyzer.js         Tesseract.js v4 OCR wrapper
│   ├── patternAnalyzer.js     Regex PII classifier
│   ├── contextAnalyzer.js     NER + label→value inference
│   ├── detectionFusion.js     Merges DOM + OCR detections
│   ├── screenshotRedactor.js  OffscreenCanvas PII masking
│   └── privacyEngine.js       Full pipeline (used by Chat mode)
│
├── agent/                     Agent layer (new in V4)
│   ├── agentState.js          Session state + detection ID registry
│   ├── toolRegistry.js        Allowed-tool definitions (Gemini schema)
│   ├── toolValidator.js       Security boundary — validates LLM output
│   ├── toolExecutor.js        Static dispatcher → tool implementations
│   ├── llmClient.js           Gemini function-calling API wrapper
│   ├── agentManager.js        Main agent loop (Observe → Decide → Act)
│   └── tools/
│       ├── scanDom.js         Wraps detector.js pipeline
│       ├── screenshot.js      chrome.tabs.captureVisibleTab
│       ├── scanOcr.js         Wraps OcrAnalyzer + Pattern + Context
│       ├── fuseDetections.js  Wraps DetectionFusion
│       ├── redact.js          Wraps ScreenshotRedactor
│       ├── verifyRedaction.js Compares detectionMap vs redactedIds
│       └── getPageContext.js  Returns safe page metadata
│
├── lib/
│   └── tesseract.min.js       OCR engine (bundled, no CDN)
│
└── test/
    └── agent-test.html        Unit tests (no API key needed)
```

---

## Data Flow: Chat Mode

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

---

## Data Flow: Agent Mode

```
User types task → AgentManager.run(task)
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
    │   [Tool runs — see Privacy Engine above]          │
    │       ↓                                           │
    │   Result sanitized (strip raw values)             │
    │       ↓                                           │
    │   Append function_response to messages            │
    │       ↓                                           │
    └── AgentLLMClient.generateWithTools(messages) ◄────┘
    │
    └── [Gemini returns text] → Task complete → show summary
```

Loop bounded by:
- `MAX_AGENT_STEPS = 10` — absolute step limit
- `MAX_SAME_TOOL_IN_A_ROW = 2` — prevents infinite tool repetition

---

## Privacy Data Flow

At no point does raw PII flow to Gemini:

```
DOM detection                  OCR detection
{ matchedText: "user@x.com"   { text: "555-1234"
  rect: {x,y,w,h}               rect: {x,y,w,h}
  selector: ".email-field"       confidence: 0.82
  confidence: 0.91 }             category: "phone" }
         │                              │
         └──────────── fuse ────────────┘
                          │
                    AgentState.assignDetectionIds()
                          │
                    { detectionMap: {
                        det_0: { ... full detection ... },
                        det_1: { ... full detection ... }
                      }
                    }
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
  Sent to LLM (safe)              Kept local (sensitive)
  [                               detectionMap internals:
    { id: "det_0",                  matchedText, rect,
      category: "email",            selector, _el
      confidence: 0.91,
      sources: ["dom"]
    },
    { id: "det_1",
      category: "phone",
      confidence: 0.82,
      sources: ["ocr"]
    }
  ]
```

---

## Security Boundaries

### The ToolValidator is the single enforcement point

Every LLM-generated tool call passes through `ToolValidator.validate()` before execution:

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

### ToolExecutor uses static dispatch only

```javascript
// GOOD — static switch/case, no dynamic routing
switch (toolCall.name) {
  case "scan_dom":        return ScanDom.execute(state, tabId);
  case "take_screenshot": return Screenshot.execute(state, tabId);
  // …
  default: throw new Error("Unknown tool: " + toolCall.name);
}
```

`chrome.scripting.executeScript` is called **only** with hardcoded extension file paths — never with LLM-generated script content.

---

## Key Libraries

| Library | Version | Purpose | Loaded from |
|---------|---------|---------|-------------|
| Tesseract.js | 4.x | In-browser OCR | `lib/tesseract.min.js` (bundled) |
| Gemini API | 2.0-flash | LLM reasoning + function calling | REST (fetch) |
| OffscreenCanvas | browser built-in | Screenshot redaction | — |

No external frameworks (React, Vue, etc.) — plain JavaScript throughout.

---

## Extension Permissions

| Permission | Why |
|-----------|-----|
| `sidePanel` | Side panel UI |
| `storage` | Store API key locally |
| `activeTab` | Access the current tab |
| `scripting` | Inject contentScript for DOM scanning |
| `tabs` | Capture screenshot for redaction |

No broad host permissions (`<all_urls>`). The extension accesses only the current active tab, only when the user opens the side panel and triggers a scan or agent run.
