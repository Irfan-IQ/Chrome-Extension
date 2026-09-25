import { useEffect, useState } from 'react';

export default function SettingsPanel({ onClose }) {
  const [backendMode, setBackendMode] = useState('direct');
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:8000');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState({ text: '', kind: '' });

  useEffect(() => {
    (async () => {
      try {
        const key = await window.Gemini.getApiKey();
        setApiKey(key || '');
        const stored = await chrome.storage.local.get(['backendMode', 'serverUrl']);
        setBackendMode(stored.backendMode || 'direct');
        setServerUrl(stored.serverUrl || 'http://127.0.0.1:8000');
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  async function save() {
    if (backendMode === 'direct' && !apiKey.trim()) {
      setStatus({ text: 'Enter a Gemini key for direct cloud mode.', kind: 'err' });
      return;
    }
    try {
      await chrome.storage.local.set({
        backendMode,
        serverUrl: serverUrl.trim() || 'http://127.0.0.1:8000',
      });
      if (apiKey.trim()) await window.Gemini.setApiKey(apiKey.trim());
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
        <option value="direct">Direct Gemini Cloud (Default)</option>
        <option value="server">Local FastAPI Server (Open-Weights VLM)</option>
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
          placeholder="http://127.0.0.1:8000"
          autoComplete="off"
          spellCheck="false"
        />
      </div>

      <div id="api-key-group">
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
        <button className="secondary-btn" onClick={onClose}>Close</button>
      </div>
      <p className={'settings-status' + (status.kind ? ' ' + status.kind : '')}>
        {status.text}
      </p>
      <p className="settings-hint">
        Saved locally in this browser via <code>chrome.storage.local</code>.
      </p>
    </section>
  );
}
