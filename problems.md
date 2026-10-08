# things to fix / watch out for

tested the updated React + Vite repo today, overall the refactor is solid and offline OCR was actually solved by bundling the wasm and traineddata in `public/lib/`, but found a few things across the new codebase we should know about before demoing to judges.

### 1. `test/agent-test.html` paths are broken after the React refactor [fixed]
* `test/agent-test.html` still pointed to `../agent/agentState.js`, `../agent/toolRegistry.js`, and `../agent/toolValidator.js`.
* since everything got moved into `src/agent/`, opening `test/agent-test.html` threw 404s for the scripts.
* updated those script tags to `type="module"` importing cleanly from `../src/agent/...`, tests pass now.

### 2. iterative redaction screenshot bug [fixed]
* in `src/agent/tools/redact.js`, it called `ScreenshotRedactor.redact()` on `state.rawScreenshot` with only the detections passed in the *current* tool call.
* if the LLM redacted incrementally (like redacting emails on step 4, then phone numbers on step 6), the second call painted over the clean raw screenshot and replaced `state.redactedScreenshot`.
* result was emails got unmasked in the final image even though `verify_redaction` reported all good.
* fixed: now accumulates all historical redacted detections across turns and paints them all into `rawScreenshot`.

### 3. Indian bank account regex catches literally every 9-18 digit number [fixed]
* in `src/privacy/patternAnalyzer.js`, Indian bank accounts were matched using `/^\d{9,18}$/` with zero prefix or context check.
* because confidence was 0.78 (above the 0.60 threshold), any 9 to 18 digit number—timestamps, tracking IDs, order numbers, phone numbers without pluses—got flagged as a `bank_account` and redacted.
* added a banking context keyword guard (`account`, `a/c`, `bank`, `ifsc`, etc.) so normal numbers don't get falsely masked.

### 4. DOM text deduplication skips repeated PII [fixed]
* in `src/privacy-page/detector.js` (`scanTextNodes()`), it deduplicated matched text strings using `seen.has(matched)`.
* if someone had the same email or phone number in two different places on a page (like header and footer, or profile card and contact table), only the first one got masked. The second stayed unredacted.
* switched deduplication to element bounding-box keys so repeated instances across different locations are all properly masked.

### 5. YuNet ONNX face detection weights are missing from the repo [handled gracefully]
* as noted in the readme, `public/models/yunet/face_detection_yunet_2023mar.onnx` is ignored in git and not in the repo.
* if someone tries running face detection or building without downloading the weights from OpenCV Zoo first, the vision worker used to crash the whole screenshot pipeline.
* fixed: vision engine now catches missing model weights gracefully, marks YuNet unavailable without rejecting, and lets OpenCV card detection continue running independently.

### 6. model id discrepancy (`gemini-3-flash-preview` vs `gemini-2.0-flash`) [fixed]
* `README.md` says we use `gemini-2.0-flash`.
* but `src/modelConfig.js` sets `GEMINI_MODEL = 'gemini-3-flash-preview'`.
* fixed: added `GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash'` in `modelConfig.js` and wired fallback retry in `gemini.js` so unsupported preview keys gracefully downgrade.

### 7. 3 browser action tools are in code but missing from readme [fixed]
* `click_element`, `navigate_to`, and `open_tab` are implemented in `src/agent/tools/` and registered in `src/agent/toolRegistry.js`.
* `agentManager.js` `buildStepMessage()` used to just print generic "Completed." for them. Added proper step message formatters so it shows clicked elements, URLs, and switched tabs.
* `click_element` also now auto-scrolls targets into center view and skips disabled elements.

### 8. only visible viewport gets masked
* `chrome.tabs.captureVisibleTab` only screenshots what is currently visible on screen.
* If a form has fields below the fold, DOM scan detects them, but the screenshot redactor only covers what fits inside the current screen bounds.
* mitigated: `click_element` automatically scrolls targets into center view before interaction.

### 9. manifest version & description out of sync [fixed]
* `manifest.json` and `package.json` were on version `"3.0.0"` and described as "V3 hybrid DOM+OCR".
* bumped both to `4.0.0` and updated descriptions to reflect the V4 autonomous agent mode.

### 10. web accessible resources leak / extension fingerprinting [fixed]
* `manifest.json` exposed `lib/tesseract.worker.min.js`, `lib/tesseract.min.js`, etc. to all origins without dynamic urls.
* any webpage could probe `chrome-extension://<id>/lib/tesseract.min.js` to fingerprint whether the user has Redact Agent installed.
* added `use_dynamic_url: true` to prevent external fingerprinting.

### 11. prompt injection risk with unconfirmed click & navigation tools [guarded]
* `click_element` executes `document.querySelector(sel).click()` on whatever the LLM passes without asking the user.
* `navigate_to` takes any `http/https` URL from the LLM.
* guarded: strictly validate `http://` and `https://` schemas on all navigation tools, blocking `javascript:`, `data:`, `file:`, or internal chrome schemes. Added disabled element checks so disabled actions aren't triggered.

### 12. agent step limit is tight [fixed]
* `agentManager.js` `MAX_AGENT_STEPS` is set to 15 so happy paths with multi-step redactions and verifications don't hit the ceiling prematurely.

### 13. server CORS wildcard & bearer token auth [fixed]
* cleaned up CORS credentials behavior and added `Authorization` to `allow_headers`.
* server now accepts standard `Authorization: Bearer <token>` in addition to `X-Redact-Agent-Token`.

### 14. server upgraded to H200 cluster & Qwen3-VL-30B-A3B [sorted]
* running `Qwen/Qwen3-VL-30B-A3B-Instruct` natively in BF16 unquantized on the 141 GB VRAM H200.
* vLLM runs on dedicated port 8001 so it stops colliding with the FastAPI gateway on 8000.
* tool call IDs and model parameters wired cleanly through `llmClient.js` and `agentManager.js` so Hermes tool-calling doesn't throw 422s.

### 15. uninspectable regions reporting in DOM scan [fixed]
* when cross-origin iframes or canvas elements are found, `scan_dom` now returns `uninspectableRegions` metadata with host and reason.
* agent LLM gets notified to run OCR/vision over those regions.

### 16. server metrics exception tracking & RPS window [fixed]
* `auth_and_log` middleware now catches exceptions to record latency and error status in `metrics_tracker`.
* `requests_per_second` rolling window calculates accurately during early server uptime instead of dividing by fixed 10s.
