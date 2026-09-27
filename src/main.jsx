import './vision/visionEngine.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './sidepanel.css';

// ESM modules. Mirror to window for consumers that still read them that way:
//   • React components (ChatMode, AgentMode, SettingsPanel)
//   • agent/tools/* (scanOcr, fuseDetections, redact, toolExecutor's autoCapture)
// These bridges disappear once every consumer imports directly.
import { AgentManager }       from './agent/agentManager.js';
import { Gemini }             from './gemini.js';
import { PrivacyEngine }      from './privacy/privacyEngine.js';
import { PatternAnalyzer }    from './privacy/patternAnalyzer.js';
import { ContextAnalyzer }    from './privacy/contextAnalyzer.js';
import { OcrAnalyzer }        from './privacy/ocrAnalyzer.js';
import { DetectionFusion }    from './privacy/detectionFusion.js';
import { ScreenshotRedactor } from './privacy/screenshotRedactor.js';

window.AgentManager       = AgentManager;
window.Gemini             = Gemini;
window.PrivacyEngine      = PrivacyEngine;
window.PatternAnalyzer    = PatternAnalyzer;
window.ContextAnalyzer    = ContextAnalyzer;
window.OcrAnalyzer        = OcrAnalyzer;
window.DetectionFusion    = DetectionFusion;
window.ScreenshotRedactor = ScreenshotRedactor;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
