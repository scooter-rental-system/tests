// Serves the frontend repository's source for the E2E run, proxying /api to the backend under test (API_BASE_URL).
// Equivalent to the frontend's own vite.config.ts, whose proxy target is fixed to localhost:8080.
import path from 'node:path';

export default {
  root: path.resolve(process.env.FRONTEND_DIR || '../frontend'),
  esbuild: { jsx: 'automatic' },
  server: {
    strictPort: true,
    proxy: { '/api': { target: process.env.API_BASE_URL || 'http://localhost:8080', changeOrigin: false } },
  },
};
