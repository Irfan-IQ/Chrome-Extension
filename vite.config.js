import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

// Vite builds the React sidepanel into dist/. Vanilla modules that predate the
// React rewrite (gemini.js, privacy/*, agent/*) are copied verbatim so they load
// into `window.*` just like the old build. Static assets under public/ (icons,
// lib, models) are copied automatically by Vite.
//
// Load the dist/ folder as the unpacked extension in Chrome.
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'manifest.json',      dest: '.' },
        { src: 'src/background.js',  dest: '.' },
        { src: 'privacy/*.js',       dest: 'privacy' },
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
