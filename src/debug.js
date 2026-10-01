// Centralised debug logger.
//
// All privacy / agent hot-paths funnel verbose output through here instead
// of calling console.log/debug directly, so production builds can stay
// silent without hunting log sites. Vite replaces `import.meta.env.DEV`
// with a literal `false` under `vite build --mode production` (the default
// for `npm run build`), letting Rollup dead-code-eliminate the calls.
//
// Set `window.__REDACT_DEBUG = true` in the console to re-enable at runtime.

const BUILD_TIME_DEBUG = typeof import.meta !== 'undefined'
  && import.meta.env
  && import.meta.env.DEV === true;

function enabled() {
  if (BUILD_TIME_DEBUG) return true;
  try { return typeof window !== 'undefined' && window.__REDACT_DEBUG === true; }
  catch (_) { return false; }
}

export function debug(...args) {
  if (enabled()) console.debug(...args);
}

export function info(...args) {
  if (enabled()) console.info(...args);
}

// Warnings and errors always fire — they signal something actionable.
export const warn  = (...a) => console.warn(...a);
export const error = (...a) => console.error(...a);
