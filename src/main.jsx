import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './sidepanel.css';

// Previously this file imported each ES module and mirrored it onto `window.*`
// so legacy consumers could reach it as a global. Every consumer now imports
// directly, so the bridge is gone — Rollup can tree-shake unused exports.
//
// Two globals remain, and MUST remain, because they come from classic
// <script> tags in sidepanel.html rather than the ES module graph:
//   • window.Tesseract        — set by lib/tesseract.min.js
//   • window.CoordinateUtils  — set by privacy/coordinateUtils.js (the same
//                               file is also injected into page-realm by
//                               chrome.scripting.executeScript, so it has
//                               to stay a classic script).

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
