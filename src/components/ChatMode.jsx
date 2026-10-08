import { useCallback, useEffect, useRef, useState } from 'react';
import {
  STORAGE_KEY_HISTORY,
  STORAGE_KEY_PRIVACY,
  countByCategory,
  humanLabel,
  buildPageContextText,
} from '../utils.js';
import { Gemini } from '../gemini.js';
import { PrivacyEngine } from '../privacy/privacyEngine.js';
import ScanResultPanel from './ScanResultPanel.jsx';
import DebugList from './DebugList.jsx';

export default function ChatMode({ setStatus, openZoom, clearSignal, active }) {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [privacyEnabled, setPrivacyEnabled] = useState(true);
  // `node` holds a React element rendered via normal JSX (safe) instead of
  // an HTML string injected via dangerouslySetInnerHTML. `text` is still
  // used for plain-string statuses (working/err).
  const [privacyStatus, setPrivacyStatus] = useState({ kind: '', text: '', node: null });
  const [privacyDetailOpen, setPrivacyDetailOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState(null);
  const [scanResult, setScanResult] = useState(null); // { dets, summary, ocrOn, ocrWordCount, before, sanitized }
  const [scanTab, setScanTab] = useState('sanitized');
  const [scanning, setScanning] = useState(false);
  const chatRef = useRef(null);
  const textareaRef = useRef(null);

  // ---- Load history + privacy pref on mount ----
  useEffect(() => {
    (async () => {
      try {
        const data = await chrome.storage.local.get([STORAGE_KEY_HISTORY, STORAGE_KEY_PRIVACY]);
        setHistory(Array.isArray(data[STORAGE_KEY_HISTORY]) ? data[STORAGE_KEY_HISTORY] : []);
        const p = data[STORAGE_KEY_PRIVACY];
        setPrivacyEnabled(p === undefined ? true : !!p);
      } catch (e) {
        console.error('Failed to load state:', e);
      }
      try {
        const { backendMode = 'server' } = await chrome.storage.local.get('backendMode');
        const key = await Gemini.getApiKey();
        if (!key && backendMode !== 'server') {
          setHistory((h) =>
            h.length === 0
              ? [
                  {
                    role: 'assistant',
                    kind: 'error',
                    content:
                      'Please configure your Gemini API key in Settings (⚙ top right).',
                  },
                ]
              : h,
          );
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  // ---- Clear signal from parent ----
  useEffect(() => {
    if (clearSignal === 0) return;
    (async () => {
      setHistory([]);
      try {
        await chrome.storage.local.remove(STORAGE_KEY_HISTORY);
      } catch (e) {
        console.error(e);
      }
      textareaRef.current?.focus();
    })();
  }, [clearSignal]);

  // ---- Focus on activation ----
  useEffect(() => {
    if (active) textareaRef.current?.focus();
  }, [active]);

  // ---- Scroll to bottom on new messages ----
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [history, sending]);

  // ---- Persist privacy pref ----
  useEffect(() => {
    chrome.storage.local
      .set({ [STORAGE_KEY_PRIVACY]: privacyEnabled })
      .catch((e) => console.error('Failed to save privacy pref:', e));
  }, [privacyEnabled]);

  const saveHistory = useCallback(async (h) => {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY_HISTORY]: h });
    } catch (e) {
      console.error('Failed to save chat history:', e);
    }
  }, []);

  function renderPrivacySummary(result) {
    const dets = result.detectedElements || [];
    const uninspectable = result.uninspectable || [];
    const ocrEnabled = !!result.ocrEnabled;
    const ocrWC = result.ocrWordCount || 0;

    if (dets.length === 0 && uninspectable.length === 0) {
      const modeLabel = ocrEnabled ? 'DOM+OCR' : 'DOM-only';
      setPrivacyStatus({
        kind: 'ok',
        text: `No sensitive fields detected (${modeLabel} scan). Page snapshot attached.`,
        node: null,
      });
    }

    if (dets.length > 0 || uninspectable.length > 0) {
      const counts = countByCategory(dets);
      // Compose with JSX so React escapes every interpolated value.
      // Previously this used dangerouslySetInnerHTML with a concatenated
      // string that embedded category keys sourced from page content —
      // an XSS vector inside the extension's privileged origin.
      const node = (
        <>
          <span>Detected:&nbsp;</span>
          {Object.keys(counts).map((k) => (
            <span key={k} className="det-chip">
              {counts[k]} {humanLabel(k)}
            </span>
          ))}
          {ocrEnabled && ocrWC > 0 && (
            <span className="ocr-badge">+ OCR ({ocrWC} words)</span>
          )}
          {uninspectable.length > 0 && (
            <div className="uninspectable-note">
              {uninspectable.length} uninspectable region(s) — cross-origin iframe, not scanned.
            </div>
          )}
        </>
      );
      setPrivacyStatus({ kind: 'ok', text: '', node });
    }

    setDebugData({
      dets,
      fusionSummary: result.fusionSummary,
      ocrEnabled,
      ocrWordCount: ocrWC,
      visionEnabled: !!result.visionEnabled,
      visionSummary: result.visionSummary || null,
      visionStatus: result.visionStatus || null,
    });
  }

  async function handleSend() {
    if (sending) return;
    const text = input.trim();
    if (!text) return;

    const priorHistory = history.slice();
    const withUser = [...history, { role: 'user', content: text }];
    setHistory(withUser);
    setInput('');
    await saveHistory(withUser);

    setSending(true);
    setStatus('busy');

    let geminiOptions = {};
    if (privacyEnabled) {
      try {
        setPrivacyStatus({ kind: 'working', text: 'Scanning page…', node: null });
        const result = await PrivacyEngine.sanitizeCurrentPage((m) =>
          setPrivacyStatus({ kind: 'working', text: m, node: null }),
        );
        renderPrivacySummary(result);
        geminiOptions = {
          imageDataUrl: result.sanitizedScreenshot,
          pageContext: buildPageContextText(result),
        };
      } catch (privErr) {
        console.error('Privacy pipeline failed:', privErr?.message || privErr);
        setPrivacyStatus({
          kind: 'err',
          text: 'Sanitisation failed — request blocked.',
          node: null,
        });
        const errMsg =
          'Privacy sanitisation failed. The request was not sent.\n\n' +
          'Reason: ' + (privErr?.message || 'unknown error') +
          '\n\nTip: turn off Privacy Protection to chat without page context.';
        const next = [...withUser, { role: 'assistant', kind: 'error', content: errMsg }];
        setHistory(next);
        await saveHistory(next);
        setStatus('error');
        setSending(false);
        textareaRef.current?.focus();
        return;
      }
    } else {
      setPrivacyStatus({ kind: '', text: '', node: null });
    }

    try {
      const reply = await Gemini.sendMessage(text, priorHistory, geminiOptions);
      const next = [...withUser, { role: 'assistant', content: reply }];
      setHistory(next);
      await saveHistory(next);
      setStatus('ready');
    } catch (err) {
      console.error('Send failed:', err);
      const friendly =
        err?.message || 'Sorry, something went wrong while contacting Gemini.';
      const next = [...withUser, { role: 'assistant', kind: 'error', content: friendly }];
      setHistory(next);
      await saveHistory(next);
      setStatus('error');
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  async function handleScan() {
    if (scanning) return;
    setScanning(true);
    setPrivacyStatus({ kind: 'working', text: 'Starting scan…', node: null });
    setScanResult(null);

    try {
      const result = await PrivacyEngine.scanPage((m) =>
        setPrivacyStatus({ kind: 'working', text: m, node: null }),
      );

      const dets = result.detectedElements || [];
      let domCount = 0, ocrCount = 0;
      for (const d of dets) {
        const srcs = d.sources || ['dom'];
        if (srcs.indexOf('dom') !== -1) domCount++;
        if (srcs.some((s) => s !== 'dom')) ocrCount++;
      }
      const counts = countByCategory(dets);
      setScanResult({
        domCount,
        ocrCount,
        totalCount: dets.length,
        ocrOn: !!result.ocrEnabled,
        visionOn: !!result.visionEnabled,
        visionSummary: result.visionSummary || null,
        visionStatus: result.visionStatus || null,
        counts,
        before: result.beforeScreenshot || '',
        sanitized: result.sanitizedScreenshot || '',
      });
      setScanTab('sanitized');
      renderPrivacySummary(result);
    } catch (err) {
      setPrivacyStatus({
        kind: 'err',
        text: 'Scan failed: ' + (err?.message || 'Unknown error during scan.'),
        node: null,
      });
      console.error('[Scan]', err);
    } finally {
      setScanning(false);
    }
  }

  const emptyState = history.length === 0;

  return (
    <>
      <section id="privacy-strip" className="privacy-strip">
        <div className="privacy-row">
          <label className="privacy-toggle">
            <input
              type="checkbox"
              checked={privacyEnabled}
              onChange={(e) => {
                setPrivacyEnabled(e.target.checked);
                setPrivacyStatus({ kind: '', text: '', node: null });
              }}
            />
            <span>
              Privacy Protection:{' '}
              <strong className={privacyEnabled ? '' : 'off'}>
                {privacyEnabled ? 'ON' : 'OFF'}
              </strong>
            </span>
          </label>
          <div className="privacy-actions">
            <button
              className="scan-btn"
              disabled={scanning}
              title="Scan page and generate sanitized screenshot"
              onClick={handleScan}
            >
              {scanning ? 'Scanning…' : '🛡 Scan Page'}
            </button>
            <button
              className="icon-btn v3-badge"
              title="Show detection debug info"
              onClick={() => setDebugOpen((v) => !v)}
            >
              Debug
            </button>
            <button
              className="icon-btn"
              title="About V3 privacy"
              onClick={() => setPrivacyDetailOpen((v) => !v)}
            >
              ?
            </button>
          </div>
        </div>

        {privacyDetailOpen && (
          <div className="privacy-detail">
            <strong>V4 Hybrid Privacy Engine</strong>
            <br />
            Attaches a locally-sanitised snapshot to every message when ON.
            <br />
            <em>DOM scan</em> — detects form fields by attribute analysis.
            <br />
            <em>OCR</em> — reads visible text in images &amp; canvas (Tesseract.js, fully local).
            <br />
            <em>Pattern</em> — regex classifies email, phone, card numbers, etc.
            <br />
            <em>Context / NER</em> — label-value pairs and person-name heuristics.
            <br />
            <em>Fusion</em> — multiple signals for the same region → higher confidence.
            <br />
            All processing is <strong>local to your browser</strong>. No raw screenshot or sensitive
            text ever leaves your device.
          </div>
        )}

        <div className={'privacy-status' + (privacyStatus.kind ? ' ' + privacyStatus.kind : '')}>
          {privacyStatus.node ?? privacyStatus.text}
        </div>

        {debugOpen && (
          <div className="debug-panel">
            <div className="debug-header">
              <span>Detection Log</span>
              <button className="icon-btn" onClick={() => setDebugOpen(false)}>
                ✕
              </button>
            </div>
            <DebugList data={debugData} />
          </div>
        )}
      </section>

      {scanResult && (
        <ScanResultPanel
          result={scanResult}
          activeTab={scanTab}
          setActiveTab={setScanTab}
          onZoom={openZoom}
          onClose={() => setScanResult(null)}
        />
      )}

      <main id="chat" className="chat" aria-live="polite" ref={chatRef}>
        {emptyState ? (
          <div className="empty-state">Ask the assistant anything to get started.</div>
        ) : (
          history.map((msg, i) => {
            const isUser = msg.role === 'user';
            const kind = msg.kind || (isUser ? 'user' : 'ai');
            return (
              <div key={i} className={'msg ' + kind}>
                <div className="role">{isUser ? 'You' : 'AI'}</div>
                <div className="bubble">{msg.content}</div>
              </div>
            );
          })
        )}
        {sending && (
          <div className="msg ai typing">
            <div className="role">AI</div>
            <div className="bubble">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}
      </main>

      <footer id="composer">
        <textarea
          id="input"
          ref={textareaRef}
          rows="1"
          placeholder="Ask something…"
          aria-label="Message"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 120) + 'px';
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button className="primary-btn" disabled={sending} onClick={handleSend}>
          {sending ? '…' : 'Send'}
        </button>
      </footer>
    </>
  );
}

