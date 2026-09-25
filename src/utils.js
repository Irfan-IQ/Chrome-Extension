// Shared helpers used across the React app.

export const STORAGE_KEY_HISTORY = 'chatHistory';
export const STORAGE_KEY_PRIVACY = 'privacyEnabled';

export const PII_LABELS = {
  name: 'Name',
  email: 'Email',
  password: 'Password',
  age: 'Age',
  phone: 'Phone Number',
  address: 'Address',
  username: 'Username',
  date_of_birth: 'Date of Birth',
  credit_card: 'Card Number',
  ssn: 'Aadhaar / PAN / ID',
  api_key: 'API Key / Token',
  bank_account: 'Bank Account',
};

export const humanLabel = (category) => PII_LABELS[category] || category;

export function countByCategory(detections) {
  const counts = {};
  for (const d of detections || []) {
    counts[d.category] = (counts[d.category] || 0) + 1;
  }
  return counts;
}

export function buildPageContextText(result) {
  const dom = result.sanitizedDOM || {};
  const dets = result.detectedElements || [];
  const lines = [];

  lines.push('[V3 Privacy-sanitised page context — produced locally by the extension]');
  lines.push('Source host: ' + (result.host || 'unknown'));
  lines.push(
    'Scan mode: ' +
      (result.ocrEnabled
        ? 'DOM + OCR + Pattern + Context + Fusion'
        : 'DOM-only (OCR unavailable)'),
  );
  lines.push(
    'This scan inspects the DOM and visible rendered content (via local OCR). It does NOT analyse image semantics for non-text sensitive data.',
  );

  if (dets.length) {
    const counts = countByCategory(dets);
    lines.push(
      'Detected sensitive regions (values redacted): ' +
        Object.keys(counts)
          .map((k) => counts[k] + ' ' + k)
          .join(', '),
    );
    const byCategory = {};
    for (const d of dets) {
      if (!byCategory[d.category]) byCategory[d.category] = new Set();
      (d.sources || ['dom']).forEach((s) => byCategory[d.category].add(s));
    }
    lines.push(
      'Evidence sources: ' +
        Object.entries(byCategory)
          .map(([k, s]) => k + '=[' + [...s].join(',') + ']')
          .join(', '),
    );
  } else {
    lines.push('No sensitive DOM fields or OCR text were detected.');
  }

  if (result.uninspectable && result.uninspectable.length) {
    lines.push(
      result.uninspectable.length +
        ' cross-origin iframe(s) could NOT be inspected; treat those regions as unknown.',
    );
  }

  lines.push('Sanitised DOM (JSON, contains NO sensitive values): ' + JSON.stringify(dom));
  lines.push('The attached screenshot has every sensitive region covered by an opaque block.');
  return lines.join('\n');
}

export function formatDuration(ms) {
  if (!ms || ms <= 0) return '';
  return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
}
