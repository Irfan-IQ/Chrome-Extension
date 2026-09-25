import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

// Vite builds the React sidepanel into dist/. All legacy vanilla modules
// (gemini.js, privacy/*, agent/*, lib/*, background.js, icons/*) are copied
// verbatim so they load into `window.*` exactly like the old build.
// Load the dist/ folder as the unpacked extension in Chrome.
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'background.js', dest: '.' },
        { src: 'gemini.js',     dest: '.' },
        { src: 'privacy/*.js',  dest: 'privacy' },
        { src: 'agent/*.js',    dest: 'agent' },
        { src: 'agent/tools/*.js', dest: 'agent/tools' },
        { src: 'lib/*',   dest: 'lib' },
        { src: 'icons/*', dest: 'icons' },
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
      },
    },
  },
});
