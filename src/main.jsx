import './vision/visionEngine.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './sidepanel.css';

// ESM modules. Expose on window for React components that still read
// them that way (ChatMode / AgentMode / SettingsPanel). These bridges
// disappear once the components import directly.
import { AgentManager } from './agent/agentManager.js';
import { Gemini }       from './gemini.js';
window.AgentManager = AgentManager;
window.Gemini       = Gemini;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
