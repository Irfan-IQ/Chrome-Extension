export default function Header({ mode, onModeChange, status, onClear, onToggleSettings }) {
  const dotClass =
    'status-dot' + (status === 'ready' ? '' : ' ' + status);
  const dotTitle =
    status === 'busy' ? 'Thinking…' : status === 'error' ? 'Error' : 'Ready';

  return (
    <header id="header">
      <div className="header-title">
        <svg className="brand-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span className="app-name">Redact Agent</span>
        <span className="app-badge" id="app-badge">V4</span>
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
