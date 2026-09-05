# Redact Agent — Agent Architecture (V4)

## Overview

Redact Agent V4 upgrades the existing Gemini-powered chatbot into a **genuine LLM-driven agent** that uses Gemini's native function-calling API to orchestrate local privacy tools.

The key principle is separation of concerns:

| Component        | Responsibility                                    |
|------------------|---------------------------------------------------|
| **LLM (Gemini)** | Plan, reason, decide which tool to call next      |
| **Validator**    | Security boundary — rejects any invalid LLM output|
| **Executor**     | Routes validated calls to trusted extension code  |
| **Privacy Engine** | Deterministic local PII detection + redaction   |
| **Browser**      | Provides the live page environment                |

---

## Architecture Diagram

```
                        USER
                         │
                         ▼
                ┌─────────────────┐
                │  AgentManager   │  agentManager.js
                │  (loop driver)  │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │  AgentLLMClient │  llmClient.js
                │  Gemini + tools │  (function calling API)
                └────────┬────────┘
                         │
                    tool_call (untrusted)
                         │
                         ▼
                ┌─────────────────┐
                │  ToolValidator  │  toolValidator.js
                │  SECURITY GATE  │  — allowlist check
                └────────┬────────┘  — type validation
                         │           — injection prevention
                    validated call
                         │
                         ▼
                ┌─────────────────┐
                │  ToolExecutor   │  toolExecutor.js
                │  (dispatcher)   │
                └────────┬────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    DOM Tools       OCR Tools    Utility Tools
    scanDom.js     scanOcr.js   screenshot.js
    fuseDetect.js  redact.js    getPageContext.js
    verifyRedact.js
          │              │              │
          └──────────────┼──────────────┘
                         ▼
              Existing Privacy Engine
              ┌──────────────────────────┐
              │  detector.js (in page)   │
              │  ocrAnalyzer.js          │
              │  patternAnalyzer.js      │
              │  contextAnalyzer.js      │
              │  detectionFusion.js      │
              │  screenshotRedactor.js   │
              │  coordinateUtils.js      │
              └──────────────────────────┘
                         │
                         ▼
                   Browser Page
```

---

## Agent Loop (Observe → Decide → Act)

```
User request
    │
    ▼
[LLM] ← receives: user request + system instruction + tool definitions
    │
    ├── tool_call → [Validator] → [Executor] → [Privacy Engine]
    │                                 │
    │                                 ▼
    │                          Execution result (metadata only)
    │                                 │
    └── ◄──────────────────────────── ┘
    │   (LLM sees result, decides next action)
    │
    ├── tool_call → … (repeat, bounded by MAX_AGENT_STEPS = 10)
    │
    └── text response → Task complete → User sees summary
```

---

## Files

### Agent Layer (`agent/`)

| File | Purpose |
|------|---------|
| `agentManager.js` | Main loop: drives LLM ↔ tool iterations |
| `agentState.js` | Session state: detections, screenshots, step log |
| `llmClient.js` | Gemini function-calling API, result sanitization |
| `toolRegistry.js` | Allowlist + Gemini-format tool definitions |
| `toolValidator.js` | Security boundary — validates every LLM tool call |
| `toolExecutor.js` | Routes validated calls to tool implementations |
| `tools/scanDom.js` | Wraps DOM detection pipeline |
| `tools/scanOcr.js` | Wraps OCR pipeline (OcrAnalyzer + Pattern + Context) |
| `tools/fuseDetections.js` | Wraps DetectionFusion |
| `tools/redact.js` | Wraps ScreenshotRedactor |
| `tools/verifyRedaction.js` | Checks redaction completeness |
| `tools/screenshot.js` | Captures the active tab |
| `tools/getPageContext.js` | Returns safe page metadata |

### Privacy Engine (`privacy/`) — **unchanged**

| File | Purpose |
|------|---------|
| `detector.js` | DOM-based PII detection (injected into page) |
| `contentScript.js` | Message bridge for page ↔ side panel |
| `coordinateUtils.js` | CSS px ↔ screenshot px conversion |
| `ocrAnalyzer.js` | Tesseract.js OCR wrapper |
| `patternAnalyzer.js` | Regex-based PII classification |
| `contextAnalyzer.js` | NER and label→value inference |
| `detectionFusion.js` | Merges DOM + OCR detections |
| `screenshotRedactor.js` | OffscreenCanvas redaction |
| `privacyEngine.js` | Full pipeline orchestrator (used by Chat mode) |

---

## Available Tools

The LLM may call **only** these tools:

| Tool | Description |
|------|-------------|
| `scan_dom` | Detect PII in the DOM via local rules |
| `take_screenshot` | Capture the active tab (stored locally) |
| `scan_ocr` | Detect PII in images/canvas via local OCR |
| `fuse_detections` | Merge DOM + OCR; assign stable detection IDs |
| `redact` | Paint opaque blocks over detection regions |
| `verify_redaction` | Confirm all detections have been masked |
| `get_page_context` | Return hostname, title, viewport (safe metadata) |

---

## Privacy Design

### What the LLM sees vs. what stays local

| Data | LLM sees? | Stays local? |
|------|-----------|--------------|
| Detection IDs (`det_0`, `det_1`, …) | ✓ | |
| Category labels (`email`, `phone`) | ✓ | |
| Confidence scores (0.0–1.0) | ✓ | |
| Source labels (`dom`, `ocr`) | ✓ | |
| Bounding-box coordinates | ✗ | ✓ |
| Raw matched text values | ✗ | ✓ |
| DOM element selectors | ✗ | ✓ |
| Raw screenshot pixels | ✗ | ✓ |
| Redacted screenshot | ✗ | ✓ |

The LLM **instructs** but never **sees** the sensitive data.

### Why the LLM cannot execute arbitrary JavaScript

1. The tool registry is a hardcoded allowlist — the LLM can only reference names from that list.
2. `ToolValidator` rejects any tool name not in the allowlist before anything is executed.
3. `ToolExecutor` uses a static `switch/case` with no dynamic dispatch.
4. `chrome.scripting.executeScript` is never called with LLM-generated code — it is only used with hardcoded file paths from the extension.

### Why tool calling is safer than prompt injection

Without tool calling, the LLM could respond with text like:
```
"I'll now execute: chrome.tabs.executeScript({code: 'document.cookie'})"
```
and a naive parser might act on that.

With Gemini's native function calling, the LLM emits **structured** `functionCall` objects. The schema is defined by the extension, not the LLM. Any tool name not in the allowlist is rejected by `ToolValidator` before reaching the extension.

---

## Security Constraints

The following are **never** allowed:
- `eval` or `Function()` with LLM-generated code
- `chrome.scripting.executeScript` with arbitrary scripts
- Unrestricted URL or DOM selector access from LLM output
- Raw PII values in the conversation history
- LLM-chosen network requests

Enforced via:
1. `ToolRegistry.ALLOWED_TOOLS` — allowlist
2. `ToolValidator.validate()` — type checks, ID format checks
3. `ToolExecutor` — static switch/case, no dynamic routing

---

## Typical Demo Flow

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

**Agent summary to user:**
> I found and redacted 7 PII instances:
> - 3 email addresses
> - 2 phone numbers
> - 2 names
>
> All regions verified masked. No sensitive values were shared with this AI.

---

## Failure Handling

| Failure | Agent response |
|---------|---------------|
| OCR fails | Skip OCR; run `fuse_detections` on DOM-only results |
| `scan_dom` finds 0 detections | LLM can call `get_page_context` to understand the page type, then attempt OCR |
| `redact` fails | Return error; LLM can retry once or report to user |
| Same tool called >2 times consecutively | Loop protection triggers; agent stops safely |
| LLM exceeds MAX_AGENT_STEPS (10) | Agent stops; user sees partial result |
| API key missing | Immediate clear error before agent starts |

---

## Observability

The agent emits a step log entry for every action:

```js
{
  step:      3,
  tool:      "scan_ocr",
  status:    "success",  // "success" | "error" | "working" | "rejected"
  message:   "OCR: 312 words, 3 detections — 1 email, 2 phone.",
  duration:  4821,       // ms
  timestamp: 1720000000000
}
```

The UI renders this as a live step list so judges/users can see the agent reasoning.

**Never logged:**
- Raw PII values
- Raw screenshot data
- DOM element content

---

## Adding a New Tool

1. Create `agent/tools/myTool.js` following the IIFE pattern.
2. Add the tool name to `ALLOWED_TOOLS` in `toolRegistry.js`.
3. Add a `functionDeclarations` entry in `toolRegistry.js`.
4. Add a `case` in `toolValidator.js → validateParams()` if it takes parameters.
5. Add a `case` in `toolExecutor.js → execute()`.
6. Load the script in `sidepanel.html` before `toolExecutor.js`.
