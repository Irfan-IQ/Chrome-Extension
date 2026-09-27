import './vision/visionEngine.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './sidepanel.css';

// Agent layer (ESM). Expose AgentManager on window for React components that
// still read it that way (AgentMode.jsx). This bridge disappears once the
// components import AgentManager directly.
import { AgentManager } from './agent/agentManager.js';
window.AgentManager = AgentManager;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
