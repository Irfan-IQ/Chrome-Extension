export default function Header({ mode, onModeChange, status, onClear, onToggleSettings }) {
  const dotClass =
    'status-dot' + (status === 'ready' ? '' : ' ' + status);
  const dotTitle =
    status === 'busy' ? 'Thinking…' : status === 'error' ? 'Error' : 'Ready';

  return (
    <header id="header">
      <div className="header-title">
        <span className="app-name">Redact Agent</span>
        <span className="app-badge" id="app-badge">Gemini · V4</span>
      </div>
      <div className="header-right">
        <div className="mode-tabs" role="tablist" aria-label="Mode">
          <button
            className={'mode-tab' + (mode === 'chat' ? ' mode-tab-active' : '')}
            role="tab"
            aria-selected={mode === 'chat'}
            onClick={() => onModeChange('chat')}
          >
            Chat
          </button>
          <button
            className={'mode-tab' + (mode === 'agent' ? ' mode-tab-active' : '')}
            role="tab"
            aria-selected={mode === 'agent'}
            onClick={() => onModeChange('agent')}
          >
            🤖 Agent
          </button>
        </div>
        <span className={dotClass} title={dotTitle} />
        <button className="icon-btn" title="Clear chat" onClick={onClear}>
          Clear
        </button>
        <button className="icon-btn" title="Settings" onClick={onToggleSettings}>
          ⚙
        </button>
      </div>
    </header>
  );
}
