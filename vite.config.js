import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any sub-path (GitHub Pages etc.).
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500, // three.js alone is ~700 kB
  },
  server: { open: true },
});
