import { humanLabel } from '../utils.js';

export default function ScanResultPanel({ result, activeTab, setActiveTab, onZoom, onClose }) {
  const {
    domCount, ocrCount, totalCount,
    ocrOn, visionSummary, visionStatus,
    counts, before, sanitized,
  } = result;

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
        <span className="guarantee-item">
          {visionStatus?.state === 'ready'
            ? '✓ YuNet loaded'
            : visionStatus?.state === 'loading'
            ? '⟳ YuNet loading'
            : '⚠ YuNet unavailable'}
        </span>
        {visionSummary && (
          <span className="guarantee-item">
            Vision: {visionSummary.faces || 0} faces · {visionSummary.cardCandidates || 0} cards
          </span>
        )}
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
