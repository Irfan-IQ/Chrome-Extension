// background.js — Manifest V3 service worker
//
// Responsibility: make the toolbar icon open Chrome's Side Panel.
// Using setPanelBehavior is the officially recommended way to open the
// side panel on action-icon click without needing an onClicked handler.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("sidePanel.setPanelBehavior failed:", error));
});

// Also set it on startup in case the service worker was restarted.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("sidePanel.setPanelBehavior failed:", error));
