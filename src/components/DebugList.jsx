import { humanLabel } from '../utils.js';

export default function DebugList({ data }) {
  if (!data) {
    return (
      <div className="debug-list">
        <span className="debug-empty">Run Scan Page to populate diagnostics.</span>
      </div>
    );
  }

  const {
    dets = [], fusionSummary,
    ocrEnabled, ocrWordCount,
    visionSummary, visionStatus,
  } = data;

  const modeLabel = ocrEnabled
    ? 'DOM + OCR + Pattern + Context + Fusion'
    : 'DOM-only (OCR fallback)';

  return (
    <div className="debug-list">
      <div className="debug-mode">Mode: {modeLabel}</div>
      <div className="debug-mode">
        Vision model: {visionStatus?.state || 'unknown'}
        {visionStatus?.message ? ` — ${visionStatus.message}` : ''}
      </div>
      {visionStatus?.modelUrl && (
        <div className="debug-mode">YuNet path: {visionStatus.modelUrl}</div>
      )}
      {visionSummary && (
        <div className="debug-mode">
          Vision detections: {visionSummary.faces || 0} face(s),{' '}
          {visionSummary.cardCandidates || 0} card candidate(s),{' '}
          {Math.round(visionSummary.wallMs || 0)} ms
        </div>
      )}
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
      {dets.length === 0 && (
        <div className="debug-empty">
          No detections survived the fusion/redaction threshold.
        </div>
      )}
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
