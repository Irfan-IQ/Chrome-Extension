import { useCallback, useEffect, useRef, useState } from 'react';
import {
  STORAGE_KEY_HISTORY,
  STORAGE_KEY_PRIVACY,
  countByCategory,
  humanLabel,
  buildPageContextText,
} from '../utils.js';

export default function ChatMode({ setStatus, openZoom, clearSignal, active }) {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [privacyEnabled, setPrivacyEnabled] = useState(true);
  const [privacyStatus, setPrivacyStatus] = useState({ kind: '', text: '', html: null });
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
        const { backendMode = 'direct' } = await chrome.storage.local.get('backendMode');
        const key = await window.Gemini.getApiKey();
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
        html: null,
      });
    }

    const counts = countByCategory(dets);
    const parts = Object.keys(counts).map(
      (k) => `<span class='det-chip'>${counts[k]} ${humanLabel(k)}</span>`,
    );
    let html = 'Detected:&nbsp;' + parts.join(' ');
    if (ocrEnabled && ocrWC > 0) {
      html += `<span class='ocr-badge'>+ OCR (${ocrWC} words)</span>`;
    }
    if (uninspectable.length) {
      html += `<div class='uninspectable-note'>${uninspectable.length} uninspectable region(s) — cross-origin iframe, not scanned.</div>`;
    }

    if (dets.length > 0 || uninspectable.length > 0) {
      setPrivacyStatus({ kind: 'ok', text: '', html });
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
        setPrivacyStatus({ kind: 'working', text: 'Scanning page…', html: null });
        const result = await window.PrivacyEngine.sanitizeCurrentPage((m) =>
          setPrivacyStatus({ kind: 'working', text: m, html: null }),
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
          html: null,
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
      setPrivacyStatus({ kind: '', text: '', html: null });
    }

    try {
      const reply = await window.Gemini.sendMessage(text, priorHistory, geminiOptions);
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
    setPrivacyStatus({ kind: 'working', text: 'Starting scan…', html: null });
    setScanResult(null);

    try {
      const result = await window.PrivacyEngine.scanPage((m) =>
        setPrivacyStatus({ kind: 'working', text: m, html: null }),
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
        html: null,
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
                setPrivacyStatus({ kind: '', text: '', html: null });
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
          {privacyStatus.html ? (
            <span dangerouslySetInnerHTML={{ __html: privacyStatus.html }} />
          ) : (
            privacyStatus.text
          )}
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

function ScanResultPanel({ result, activeTab, setActiveTab, onZoom, onClose }) {
  const { domCount, ocrCount, totalCount, ocrOn, visionOn, visionSummary, visionStatus, counts, before, sanitized } = result;
  return (
    <section className="scan-result-panel">
      <div className="scan-summary-row">
        <div className="scan-card">
          <div className="scan-card-value">{domCount}</div>
          <div className="scan-card-label">DOM regions</div>
        </div>
        <div className="scan-card">
          <div className="scan-card-value">{ocrCount}</div>
          <div className="scan-card-label">OCR regions</div>
        </div>
        <div className="scan-card scan-card-accent">
          <div className="scan-card-value">{totalCount}</div>
          <div className="scan-card-label">Protected</div>
        </div>
      </div>

      <div className="scan-guarantees">
        <span className="guarantee-item">{visionStatus?.state === 'ready' ? '✓ YuNet loaded' : visionStatus?.state === 'loading' ? '⟳ YuNet loading' : '⚠ YuNet unavailable'}</span>
        {visionSummary && <span className="guarantee-item">Vision: {visionSummary.faces || 0} faces · {visionSummary.cardCandidates || 0} cards</span>}
      </div>

      <div className="scan-guarantees">
        <span className="guarantee-item">✓ Processed locally</span>
        <span className="guarantee-item">✓ Sensitive data redacted</span>
        <span className="guarantee-item">{ocrOn ? '✓ OCR active' : '✓ DOM scan active'}</span>
      </div>

      <div className="scan-categories">
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} className="scan-cat-chip">
            {v} {humanLabel(k)}
          </span>
        ))}
      </div>

      <div className="shot-tabs">
        {before && (
          <button
            className={'shot-tab' + (activeTab === 'original' ? ' shot-tab-active' : '')}
            onClick={() => setActiveTab('original')}
          >
            Original
          </button>
        )}
        <button
          className={'shot-tab' + (activeTab === 'sanitized' ? ' shot-tab-active' : '')}
          onClick={() => setActiveTab('sanitized')}
        >
          Sanitized ✓
        </button>
      </div>

      <div className="shot-viewer">
        {activeTab === 'original' && before ? (
          <div className="shot-pane">
            <div className="shot-warning">⚠ For local comparison only. Never sent to AI.</div>
            <img
              className="shot-img"
              alt="Original page screenshot"
              src={before}
              onClick={() => onZoom(before)}
            />
          </div>
        ) : (
          <div className="shot-pane">
            <div className="shot-ok">
              ✓ This version is sent to AI — sensitive regions redacted
            </div>
            <img
              className="shot-img"
              alt="Sanitized screenshot"
              src={sanitized}
              onClick={() => onZoom(sanitized)}
            />
          </div>
        )}
      </div>

      <button className="scan-result-close" onClick={onClose}>
        ✕ Close
      </button>
    </section>
  );
}

function DebugList({ data }) {
  if (!data) {
    return (
      <div className="debug-list">
        <span className="debug-empty">Run Scan Page to populate diagnostics.</span>
      </div>
    );
  }
  const { dets = [], fusionSummary, ocrEnabled, ocrWordCount, visionEnabled, visionSummary, visionStatus } = data;
  const modeLabel = ocrEnabled
    ? 'DOM + OCR + Pattern + Context + Fusion'
    : 'DOM-only (OCR fallback)';
  return (
    <div className="debug-list">
      <div className="debug-mode">Mode: {modeLabel}</div>
      <div className="debug-mode">Vision model: {visionStatus?.state || 'unknown'}{visionStatus?.message ? ` — ${visionStatus.message}` : ''}</div>
      {visionStatus?.modelUrl && <div className="debug-mode">YuNet path: {visionStatus.modelUrl}</div>}
      {visionSummary && <div className="debug-mode">Vision detections: {visionSummary.faces || 0} face(s), {visionSummary.cardCandidates || 0} card candidate(s), {Math.round(visionSummary.wallMs || 0)} ms</div>}
      {ocrEnabled && <div className="debug-mode">OCR words found: {ocrWordCount || 0}</div>}
      {fusionSummary?.bySource && (
        <>
          <div className="debug-section">Source breakdown:</div>
          {Object.entries(fusionSummary.bySource).map(([src, count]) => (
            <div key={src} className="debug-src-row">
              <span className="src-key">{src}</span>: {count}
            </div>
          ))}
        </>
      )}
      <div className="debug-section">Detections:</div>
      {dets.length === 0 && <div className="debug-empty">No detections survived the fusion/redaction threshold.</div>}
      {dets.map((d, i) => {
        const conf =
          typeof d.confidence === 'number'
            ? (d.confidence * 100).toFixed(0) + '%'
            : String(d.confidence);
        const confClass =
          d.confidence >= 0.8 ? 'conf-high' : d.confidence >= 0.6 ? 'conf-med' : 'conf-low';
        const sources = (d.sources || ['dom']).join(' + ');
        const action = d.confidence >= 0.6 ? 'REDACTED' : 'IGNORED';
        const actionClass = action === 'REDACTED' ? 'action-redacted' : 'action-ignored';
        return (
          <div key={i} className="debug-item">
            <span className="det-type">{humanLabel(d.category)}</span>
            <span className="det-sources">Sources: {sources}</span>
            <span className={'det-conf ' + confClass}>Confidence: {conf}</span>
            <span className={'det-action ' + actionClass}>{action}</span>
          </div>
        );
      })}
    </div>
  );
}
