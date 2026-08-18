import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so a build can be opened from disk or served from any
  // sub-path (GitHub Pages project sites included).
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: false,
  },
});
