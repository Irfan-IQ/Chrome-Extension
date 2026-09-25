import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../utils.js';

const QUICK_TASKS = [
  { label: 'Redact all PII', task: 'Redact all personal information on this page' },
  { label: 'Scan & Report',  task: 'Scan this page for sensitive data and report what you find' },
  { label: 'Emails & Phones',task: 'Find and redact all email addresses and phone numbers on this page' },
];

const STEP_ICONS = {
  success: '✓',
  error: '✗',
  working: '⟳',
  rejected: '⚠',
  complete: '✓',
  done: '✓',
};

export default function AgentMode({ setStatus, openZoom, active }) {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [logStatus, setLogStatus] = useState({ text: '', kind: '' }); // 'done' | 'error' | ''
  const [steps, setSteps] = useState([]); // ordered list of step entries
  const [result, setResult] = useState(null); // { summary, redactedScreenshot, screenshotLog }
  const [galleryOpen, setGalleryOpen] = useState(false);
  const stepListRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (stepListRef.current) {
      stepListRef.current.scrollTop = stepListRef.current.scrollHeight;
    }
  }, [steps]);

  function addOrUpdateStep(entry) {
    const key = String(entry.step) + '_' + entry.tool;
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s._key === key);
      const withKey = { ...entry, _key: key };
      if (idx === -1) return [...prev, withKey];
      const next = prev.slice();
      next[idx] = withKey;
      return next;
    });
  }

  async function handleRun() {
    if (running) return;
    const task = input.trim();
    if (!task) {
      inputRef.current?.focus();
      return;
    }

    const { backendMode = 'direct' } = await chrome.storage.local.get('backendMode');
    const apiKey = await window.Gemini.getApiKey().catch(() => '');
    if (backendMode !== 'server' && !apiKey) {
      setResult({
        summary:
          'Please configure your Gemini API key in Settings (⚙ top right) before running the agent.',
      });
      return;
    }

    setRunning(true);
    setStatus('busy');
    setSteps([]);
    setResult(null);
    setGalleryOpen(false);
    setLogStatus({ text: 'Running…', kind: '' });

    try {
      const res = await window.AgentManager.run(task, apiKey, (entry) => {
        addOrUpdateStep(entry);
      });
      setLogStatus({
        text: res.success ? 'Completed ✓' : 'Stopped',
        kind: res.success ? 'done' : 'error',
      });
      setResult({
        summary: res.summary || (res.success ? 'Task complete.' : 'Task did not complete.'),
        redactedScreenshot: res.redactedScreenshot || '',
        screenshotLog: res.screenshotLog || [],
      });
    } catch (err) {
      console.error('[Agent] Unexpected error:', err);
      setLogStatus({ text: 'Error', kind: 'error' });
      setResult({ summary: 'Agent error: ' + (err?.message || 'Unknown error.') });
    } finally {
      setRunning(false);
      setStatus('ready');
    }
  }

  const shotCount = result?.screenshotLog?.length || 0;

  return (
    <>
      <section className="agent-composer-section">
        <div className="agent-composer-hint">
          Describe a privacy task. The agent will plan and execute it step by step using local
          privacy tools.
        </div>
        <div className="agent-composer-row">
          <textarea
            ref={inputRef}
            className="agent-input"
            rows="2"
            placeholder="e.g. Redact all personal information on this page"
            aria-label="Agent task"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleRun();
              }
            }}
          />
          <button
            className="primary-btn agent-run-btn"
            disabled={running}
            onClick={handleRun}
          >
            {running ? 'Running…' : '▶ Run'}
          </button>
        </div>
        <div className="agent-quick-tasks">
          {QUICK_TASKS.map((q) => (
            <button
              key={q.task}
              className="quick-task-btn"
              onClick={() => setInput(q.task)}
            >
              {q.label}
            </button>
          ))}
        </div>
      </section>

      {(running || steps.length > 0) && (
        <section className="agent-log-panel">
          <div className="agent-log-header">
            <span className="agent-log-title">Agent Execution</span>
            <span className={'agent-log-status-badge' + (logStatus.kind ? ' ' + logStatus.kind : '')}>
              {logStatus.text || 'Running…'}
            </span>
          </div>
          <div className="agent-step-list" ref={stepListRef}>
            {steps.map((entry) => {
              const icon = STEP_ICONS[entry.status] || '·';
              const durStr = formatDuration(entry.duration);
              return (
                <div key={entry._key} className={'agent-step status-' + entry.status}>
                  <span className="agent-step-icon">{icon}</span>
                  <span className="agent-step-body">
                    <span className="agent-step-tool">{entry.tool}</span>{' '}
                    <span className="agent-step-msg">{entry.message}</span>
                  </span>
                  <span className="agent-step-duration">{durStr}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {result && (
        <section className="agent-result-panel">
          <div className="agent-result-header">
            <span>Result</span>
            <button className="icon-btn" onClick={() => setResult(null)}>
              ✕
            </button>
          </div>
          <div className="agent-result-text">{result.summary}</div>

          {result.redactedScreenshot && (
            <div>
              <div className="shot-tabs" style={{ marginTop: 8 }}>
                <button className="shot-tab shot-tab-active">Redacted ✓</button>
              </div>
              <div className="shot-viewer">
                <div className="shot-pane">
                  <div className="shot-ok">
                    ✓ Sensitive regions masked by the extension — local only
                  </div>
                  <img
                    className="shot-img"
                    alt="Redacted screenshot"
                    src={result.redactedScreenshot}
                    style={{ cursor: 'zoom-in' }}
                    onClick={() => openZoom(result.redactedScreenshot)}
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {shotCount > 0 && (
        <div className="agent-screenshots-toggle-wrap">
          <button
            className="secondary-btn agent-view-screenshots-btn"
            onClick={() => setGalleryOpen((v) => !v)}
          >
            {galleryOpen
              ? `🔼 Hide Screenshots (${shotCount})`
              : `📷 View Redacted Screenshots (${shotCount})`}
          </button>
        </div>
      )}

      {shotCount > 0 && galleryOpen && (
        <section className="agent-screenshots-panel">
          <div className="agent-screenshots-header">
            <span>Redacted Screenshots ({shotCount})</span>
            <button className="icon-btn" onClick={() => setGalleryOpen(false)}>
              ✕
            </button>
          </div>
          <div className="agent-screenshots-grid">
            {result.screenshotLog.map((shot, i) => (
              <div key={i} className="agent-screenshot-thumb" title="Click to zoom">
                <div className="agent-screenshot-thumb-label">
                  Step {shot.step} · {shot.redactedCount} region
                  {shot.redactedCount !== 1 ? 's' : ''} redacted
                </div>
                <img
                  src={shot.dataUrl}
                  alt={'Redacted screenshot ' + (i + 1)}
                  onClick={() => openZoom(shot.dataUrl)}
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
