import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

// Vite builds the React sidepanel into dist/. Static assets under public/
// (icons, lib, models) are copied automatically by Vite.
//
// The extension has TWO privacy trees that intentionally cannot share a
// bundle, because they execute in different realms:
//
//   src/privacy/        → side-panel realm, bundled with the React app.
//   src/privacy-page/   → PAGE realm, injected via chrome.scripting.executeScript.
//                         Must stay as classic scripts and be copied verbatim
//                         to dist/privacy/ so the extension-relative path
//                         "privacy/detector.js" resolves at runtime.
//
// Load the dist/ folder as the unpacked extension in Chrome.
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'manifest.json',       dest: '.' },
        { src: 'src/background.js',   dest: '.' },
        { src: 'src/privacy-page/*.js', dest: 'privacy' },
      ],
    }),
  ],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // Keep the React runtime in its own chunk so the agent-mode and
        // vision-engine lazy chunks don't duplicate React, and so the
        // first-paint JS stays small. Everything else (app code, agent,
        // privacy analyzers) continues to be inlined into sidepanel.js.
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client'],
        },
      },
    },
  },
});
