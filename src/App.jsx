import { useCallback, useEffect, useState } from 'react';
import Header from './components/Header.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import ChatMode from './components/ChatMode.jsx';
import AgentMode from './components/AgentMode.jsx';
import ZoomLightbox from './components/ZoomLightbox.jsx';

export default function App() {
  const [mode, setMode] = useState('chat'); // 'chat' | 'agent'
  const [status, setStatus] = useState('ready'); // 'ready' | 'busy' | 'error'
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zoomSrc, setZoomSrc] = useState('');
  const [clearSignal, setClearSignal] = useState(0);

  const openZoom = useCallback((src) => setZoomSrc(src || ''), []);
  const closeZoom = useCallback(() => setZoomSrc(''), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') closeZoom();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeZoom]);

  const handleClear = useCallback(() => {
    setClearSignal((n) => n + 1);
    setStatus('ready');
  }, []);

  return (
    <div id="app">
      <Header
        mode={mode}
        onModeChange={setMode}
        status={status}
        onClear={handleClear}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
      />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      <div id="chat-mode-panel" className={mode === 'agent' ? 'hidden' : ''}>
        <ChatMode
          setStatus={setStatus}
          openZoom={openZoom}
          clearSignal={clearSignal}
          active={mode === 'chat'}
        />
      </div>

      <div id="agent-mode-panel" className={mode === 'chat' ? 'hidden' : ''}>
        <AgentMode setStatus={setStatus} openZoom={openZoom} active={mode === 'agent'} />
      </div>

      <ZoomLightbox src={zoomSrc} onClose={closeZoom} />
    </div>
  );
}
