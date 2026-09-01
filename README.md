# AI Assistant — Chrome Side Panel Chatbot

A minimal Chrome extension (Manifest V3) that puts a Google Gemini–powered
chatbot in Chrome's right-hand **Side Panel**. Plain HTML, CSS, and vanilla
JavaScript. No build step, no framework, no backend.

---

## Prerequisites

- **Google Chrome** 114 or newer (the Side Panel API requires 114+).
- A **Google Gemini API key** — create one for free at
  [Google AI Studio](https://aistudio.google.com/app/apikey).

---

## Installation (no build process)

There is nothing to compile. Load the folder directly:

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle, top-right).
4. Click **Load unpacked**.
5. Select this project folder (the one containing `manifest.json`).
6. Click the puzzle-piece icon in the toolbar and **pin** "AI Assistant".
7. Click the **AI Assistant** toolbar icon.
8. The Side Panel opens on the right.
9. Click the **⚙** button, paste your Gemini API key, click **Save**.
10. Type a message and press **Enter** to start chatting.

To apply code changes later: return to `chrome://extensions` and click the
**reload** (↻) icon on the extension card.

---

## Configuration

| What            | Where                                                             |
| --------------- | ---------------------------------------------------------------- |
| Gemini API key  | Side Panel → **⚙ Settings** → paste key → **Save**              |
| Storage         | `chrome.storage.local` (key stays in this browser profile only) |
| Model           | `gemini-3.6-flash` — change `GEMINI_MODEL` in `gemini.js`        |

The key is **not** in any source file. It is entered at runtime and stored
locally.

---

## Features

- Chat UI in the Chrome Side Panel with user / assistant bubbles.
- Enter to send, Shift+Enter for a newline, Send button. Empty messages ignored.
- **Conversation context** — prior turns are sent with each request.
- **Persistent history** — saved to `chrome.storage.local`, restored on reopen.
- **Clear chat** button — wipes the UI and stored history.
- Loading indicator ("typing" dots); Send is disabled while a request is in
  flight, so no duplicate requests.
- Graceful error handling for: missing key, invalid key, network failure,
  rate limit (429), API errors, blocked/empty responses. Real errors are
  logged to the console (right-click the Side Panel → Inspect).

---

## Project structure

```text
Chrome-Extension/
├── manifest.json      # MV3 manifest (V2 adds activeTab / scripting / tabs)
├── background.js      # service worker: open Side Panel on toolbar-icon click
├── sidepanel.html     # Side Panel markup
├── sidepanel.css      # styling (light theme)
├── sidepanel.js       # UI logic: rendering, storage, send flow, settings
├── gemini.js          # all Gemini API communication (no UI/DOM code)
├── icons/             # 16 / 48 / 128 px toolbar icons
├── .gitignore
└── README.md
```

---

## Security warning

**Do not ship this approach in a published extension.** Any API key placed in
or entered into a distributed Chrome extension can be extracted by anyone who
installs it — extension code and `chrome.storage` are fully readable on the
user's machine. For production you would proxy Gemini calls through a backend
that holds the key server-side and applies auth / rate limiting.

For a **local, single-user prototype** loaded via "Load unpacked", entering
your own key into `chrome.storage.local` is acceptable.

---

## Scope / known limitations (V1)

- No streaming — the full reply appears at once after Gemini responds.
- No Markdown rendering — replies are shown as plain text.
- History is unbounded; a very long conversation grows the request payload and
  storage. Use **Clear chat** to reset.
- A failed user turn is kept in history so you can retry with context intact.
- Requires the free Gemini API tier to be available in your region.
- Not tested against Chrome versions below 114.

---

# Version 2 — Local DOM privacy & redaction layer

V2 adds an **opt-in, fully local** privacy pipeline. When **Privacy Protection**
is ON, every message you send first triggers a scan of the **active tab**: the
extension detects sensitive form fields from the DOM, temporarily redacts them,
captures the visible viewport, paints **opaque blocks** over the sensitive
regions with `OffscreenCanvas`, restores the page, and only then sends the
**sanitized screenshot + a sanitized structured DOM summary + your prompt** to
Gemini.

**No vision model, no AI, no external API is used for detection.** Everything up
to the Gemini call happens in your browser.

### What V2 does NOT do

- It does **not** detect sensitive information **inside images** (it is DOM-only).
- It does **not** tokenize / reversibly mask (planned for a later version).
- It does **not** send the raw DOM or the raw screenshot anywhere — ever.

### New / changed files

```text
privacy/
├── coordinateUtils.js    # CSS-px ⇄ screenshot-px math (loaded in BOTH contexts)
├── detector.js           # [page] deterministic rule-based PII detector
├── domSanitizer.js       # [page] temporary + reversible DOM redaction
├── contentScript.js      # [page] message bridge + 8s auto-restore watchdog
├── screenshotRedactor.js # [side panel] OffscreenCanvas opaque masking
└── privacyEngine.js      # [side panel] orchestrator: sanitizeCurrentPage()
test/
└── pii-test-page.html    # local page exercising every category + negatives

manifest.json   # + "activeTab", "scripting", "tabs" permissions
gemini.js       # sendMessage() gains an optional 3rd arg { imageDataUrl, pageContext }
sidepanel.html  # + privacy status strip; loads the 3 side-panel privacy scripts
sidepanel.css   # + .privacy-strip styles
sidepanel.js    # handleSend() runs the privacy pipeline before calling Gemini
```

### Why each new permission

| Permission | Why it is needed |
| ---------- | ---------------- |
| `scripting` | Inject the privacy modules **on demand** (no always-on content script). |
| `tabs`      | Read `tab.url` to refuse `chrome://` / PDF / web-store pages, and read `windowId` for `captureVisibleTab`. |
| `activeTab` | Kept as a fallback signal. |
| `host_permissions: <all_urls>` | Required so `executeScript` + `captureVisibleTab` can run on whatever page you are viewing. `activeTab` alone is **not** reliable here: with "open side panel on icon click" Chrome does not consistently grant `activeTab`, and any grant is revoked as soon as the page reloads/navigates. Since V2's entire purpose is "scan the current page", broad host access is genuinely required. **This is a prototype trade-off** — a production build would scope this to specific sites or gate it behind an explicit per-site opt-in. |

There is still **no static `content_scripts` block** — nothing runs on your pages
until you send a message with Privacy Protection ON.

### PII categories detected

`name`, `email`, `password`, `age`, `phone`, `address`, `username`,
`date_of_birth`, `credit_card`.

Detection combines **multiple** signals — tag, `type`, `name`, `id`,
`placeholder`, `autocomplete`, `aria-label`, and associated `<label>` text — all
lowercased. Structural signals (`type="password"`, `autocomplete="cc-number"`)
score **high**; keyword matches score **medium**; only medium+ is acted on.
Short ambiguous words (`age`, `name`) are matched as **whole tokens** so
`page`, `image`, `username`, `filename` are not misclassified. An ordinary
search box is **not** flagged.

### V2 data flow

```text
You type a prompt (Privacy Protection ON)
   ↓  sidepanel.js handleSend()
PrivacyEngine.sanitizeCurrentPage()          [side panel]
   ├─ find active tab, reject chrome:// / PDF / web-store         → fail closed
   ├─ chrome.scripting.executeScript(privacy/*.js)  into the tab
   ├─ sendMessage "PRIVACY_REDACT"  ──────────────►  [page]
   │      detector.scan()      (LIVE dom, not a stale snapshot)
   │      domSanitizer.redact() (save originals → set "[REDACTED]")
   │      arm 8s auto-restore watchdog
   │      ◄── { detections (no values, no element refs), viewport, uninspectable }
   ├─ chrome.tabs.captureVisibleTab()   → RAW screenshot (stays in this function)
   ├─ ScreenshotRedactor.redact()  → OffscreenCanvas, opaque blocks → sanitized PNG
   ├─ buildSanitizedDOM()  → structure + metadata only, every value "[REDACTED]"
   └─ finally: sendMessage "PRIVACY_RESTORE"  → page back to original
   ↓
Gemini.sendMessage(prompt, history, { imageDataUrl: sanitizedPNG,
                                      pageContext: sanitizedDOMsummary })
```

If **any** step throws, the chatbot shows
`Privacy sanitization failed. The request was not sent.` and **nothing** goes to
Gemini (fail-closed).

### How sensitive values are kept from Gemini

1. The detector only ever reads **attribute metadata**, never `element.value`.
2. `domSanitizer` overwrites values with `[REDACTED]` **before** the screenshot.
3. The screenshot is redacted with **opaque** (not blurred) blocks that fully
   cover the pixels.
4. The raw screenshot variable never leaves `sanitizeCurrentPage()`; only the
   sanitized PNG is returned and it is nulled right after use.
5. The structured DOM sent to Gemini contains only `tag`, `type`, `category`,
   `confidence`, `selector`, `rect` — every `value` is the string `[REDACTED]`.
   The raw HTML is never sent.
6. Console logs print the **category only** (`Detected email field`), never a
   value.
7. Cross-origin iframes are reported as `uninspectable`, not claimed as scanned.

### CSS pixels → screenshot pixels

`captureVisibleTab` returns an image sized roughly
`viewport_CSS_size × devicePixelRatio`, further affected by browser zoom and OS
display scaling. `coordinateUtils.computeViewportScale()` sidesteps guessing by
deriving one empirical ratio:

```js
scaleX = screenshotWidth  / viewport.width;   // absorbs DPR + zoom + scaling
scaleY = screenshotHeight / viewport.height;
```

`domRectToImageRect()` then applies `scaleX/scaleY` to each rect's `x, y, width,
height` (with a few px of padding), and `clampImageRect()` keeps the block
inside the image bounds before `ctx.fillRect()`.

### How the original DOM is restored

- Before mutating, `domSanitizer.redact()` pushes a record per element
  (`{ el, kind, originalValue | originalHTML }`) onto an internal list.
- `restore()` replays that list in reverse, resetting `value` / `innerHTML`
  exactly, then clears the list. It is idempotent.
- `privacyEngine` wraps capture in `try { … } finally { PRIVACY_RESTORE }`.
- `contentScript.js` also arms an **8-second watchdog** that auto-restores the
  page if the side panel dies before sending `PRIVACY_RESTORE`.
- `<select>` cannot show arbitrary text, so its value is left intact and the
  region is covered in the screenshot only (nothing to restore).

### Load / reload

1. `chrome://extensions` → **Developer mode** ON.
2. First time: **Load unpacked** → pick this folder.
3. After pulling V2: click the **reload ↻** icon on the "AI Assistant" card
   (new permissions are added on reload — accept them).
4. Re-open the Side Panel (click the toolbar icon) so the new scripts load.

### Test with the test page

1. Serve the test page so content scripts can run on it:

   ```bash
   cd Chrome-Extension && python3 -m http.server 8000
   ```

   then open `http://localhost:8000/test/pii-test-page.html`.
   *(Or open the file directly and enable “Allow access to file URLs” for the
   extension on `chrome://extensions` → Details.)*
2. Open the Side Panel, make sure **Privacy Protection: ON**, set your API key.
3. Send any prompt (e.g. “What fields are on this page?”).
4. Expected privacy strip:

   ```text
   Privacy Protection: ON — Detected:
   • 2 Email        (name=email  +  aria-label="Email address")
   • 1 Password
   • 1 Phone Number
   • 1 Address
   • 1 Age
   • 1 Username
   • 1 Name
   • 1 Date of Birth
   • 1 Card Number
   1 uninspectable region(s) — cross-origin iframe, not scanned.
   ```

   The `ordinary_search`, `comments` textarea and `country` select are **not**
   listed. The page briefly shows `[REDACTED]` in the fields, then returns to
   its original values. The screenshot Gemini receives has black blocks over
   each sensitive field.
5. Turn Privacy Protection **OFF** and send again → identical to V1 (no scan,
   no screenshot).

### V2 remaining limitations

- **Broad host permission:** V2 requests `<all_urls>` (see the permission table
  above for why `activeTab` was not enough). The scan still only runs when you
  send a message with Privacy Protection ON, on the tab that is active at that
  moment.
- **`file://` pages** need “Allow access to file URLs” enabled on the
  extension's Details page, or just serve over `http://localhost`.
- **`chrome://`, the Web Store, PDF viewer, `view-source:`** cannot be scanned →
  with Privacy ON those prompts are blocked; turn Privacy OFF to chat without
  page context.
- **DOM-only:** text baked into images, `<canvas>`, or Shadow DOM (closed) is
  not detected. Same-origin iframes are scanned; cross-origin iframes are listed
  as `uninspectable`.
- **Heuristic detector:** deterministic keyword/attribute rules will miss
  unlabelled/obfuscated fields and may occasionally over- or under-match. It is
  a first-pass filter, not a guarantee.
- **Rects are captured pre-redaction.** If the page reflows *because* a value
  changed to `[REDACTED]`, a mask can be a few px off. Padding covers small
  shifts.
- **No tokenization / no reversibility** — redaction is destructive to the
  representation sent out (the live page is still fully restored).
- The sanitized (already-masked) screenshot **is** sent to Gemini — that is
  intentional and safe; only the *original* screenshot is forbidden.
