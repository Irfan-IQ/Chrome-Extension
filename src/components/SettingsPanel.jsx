import { useEffect, useState } from 'react';
import { Gemini } from '../gemini.js';
import {
  LOCAL_MODEL_LABEL,
  DEFAULT_BACKEND_MODE,
  DEFAULT_SERVER_URL,
} from '../modelConfig.js';

export default function SettingsPanel({ onClose }) {
  const [backendMode, setBackendMode] = useState(DEFAULT_BACKEND_MODE);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [serverToken, setServerToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState({ text: '', kind: '' });

  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const key = await Gemini.getApiKey();
        setApiKey(key || '');
        const stored = await chrome.storage.local.get(['backendMode', 'serverUrl', 'serverToken']);
        setBackendMode(stored.backendMode || DEFAULT_BACKEND_MODE);
        setServerUrl(stored.serverUrl || DEFAULT_SERVER_URL);
        setServerToken(stored.serverToken || '');
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  async function testConnection() {
    if (testing) return;
    setTesting(true);
    setStatus({ text: 'Testing connection…', kind: '' });
    const t0 = Date.now();

    if (backendMode === 'server') {
      const target = (serverUrl.trim() || DEFAULT_SERVER_URL).replace(/\/+$/, '');
      try {
        const headers = {};
        if (serverToken.trim()) {
          headers['Authorization'] = 'Bearer ' + serverToken.trim();
        }
        const res = await fetch(`${target}/health`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(5000),
        });
        const ms = Date.now() - t0;
        if (!res.ok) {
          setStatus({
            text: `Server returned HTTP ${res.status} (${ms}ms). Check URL or authorization.`,
            kind: 'err',
          });
          return;
        }
        const data = await res.json();
        const modelName = data.active_model || 'online';
        setStatus({
          text: `✓ Connected (${ms}ms) · Active model: ${modelName}`,
          kind: 'ok',
        });
      } catch (e) {
        const ms = Date.now() - t0;
        setStatus({
          text: `Cannot reach server at ${target} (${ms}ms): ${e?.message || 'Connection refused'}`,
          kind: 'err',
        });
      } finally {
        setTesting(false);
      }
    } else {
      const key = apiKey.trim();
      if (!key) {
        setStatus({ text: 'Enter an API key to test.', kind: 'err' });
        setTesting(false);
        return;
      }
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
          { signal: AbortSignal.timeout(6000) }
        );
        const ms = Date.now() - t0;
        if (res.ok) {
          setStatus({ text: `✓ Gemini API verified (${ms}ms).`, kind: 'ok' });
        } else {
          setStatus({ text: `Gemini API test failed (HTTP ${res.status}).`, kind: 'err' });
        }
      } catch (e) {
        setStatus({ text: `Gemini test error: ${e?.message || 'Network error'}`, kind: 'err' });
      } finally {
        setTesting(false);
      }
    }
  }

  async function save() {
    if (backendMode === 'server' && !serverUrl.trim()) {
      setStatus({ text: 'Enter the self-hosted server endpoint.', kind: 'err' });
      return;
    }
    if (backendMode === 'direct' && !apiKey.trim()) {
      setStatus({ text: 'Enter a Gemini key for direct cloud mode.', kind: 'err' });
      return;
    }
    try {
      await chrome.storage.local.set({
        backendMode,
        serverUrl:  serverUrl.trim() || DEFAULT_SERVER_URL,
        serverToken: serverToken.trim(),
      });
      if (apiKey.trim()) await Gemini.setApiKey(apiKey.trim());
      setStatus({ text: 'Saved.', kind: 'ok' });
    } catch (e) {
      console.error('Failed to save settings:', e);
      setStatus({ text: 'Could not save settings.', kind: 'err' });
    }
  }

  return (
    <section id="settings-panel" className="settings-panel">
      <h2>Settings</h2>

      <label htmlFor="backend-mode-select">Backend Provider</label>
      <select
        id="backend-mode-select"
        style={{ marginBottom: 10 }}
        value={backendMode}
        onChange={(e) => setBackendMode(e.target.value)}
      >
        <option value="server">{LOCAL_MODEL_LABEL} — Default</option>
        <option value="direct">Gemini Cloud API</option>
      </select>

      <div
        id="server-url-group"
        className={backendMode === 'server' ? '' : 'hidden'}
        style={{ marginBottom: 10 }}
      >
        <label htmlFor="server-url-input">Server Endpoint</label>
        <input
          id="server-url-input"
          type="text"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="http://localhost:8000"
          autoComplete="off"
          spellCheck="false"
        />
        <label htmlFor="server-token-input" style={{ marginTop: 8 }}>
          Server Token (optional)
        </label>
        <input
          id="server-token-input"
          type="password"
          value={serverToken}
          onChange={(e) => setServerToken(e.target.value)}
          placeholder="Matches AUTH_TOKEN in server/.env"
          autoComplete="off"
          spellCheck="false"
        />
      </div>

      <div
        id="api-key-group"
        className={backendMode === 'direct' ? '' : 'hidden'}
      >
        <label htmlFor="api-key-input">Gemini API Key</label>
        <input
          id="api-key-input"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste your API key"
          autoComplete="off"
          spellCheck="false"
        />
      </div>

      <div className="settings-actions">
        <button className="primary-btn" onClick={save}>Save</button>
        <button className="secondary-btn" onClick={testConnection} disabled={testing}>
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        <button className="secondary-btn" onClick={onClose}>Close</button>
      </div>
      <p className={'settings-status' + (status.kind ? ' ' + status.kind : '')}>
        {status.text}
      </p>
      <p className="settings-hint">
        Redaction runs locally in your browser before anything leaves. The
        self-hosted route keeps inference on your own hardware too; the
        Gemini option is here if you need it. Settings are saved in this
        browser via <code>chrome.storage.local</code>.
      </p>
    </section>
  );
}
