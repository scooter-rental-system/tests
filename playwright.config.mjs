// E2E tests in a real browser. Either point E2E_BASE_URL at a running site (for example a staging server), or set
// FRONTEND_DIR (a clone of the frontend repository with `npm ci` run) and API_BASE_URL, and the frontend is served
// locally with Vite on E2E_PORT (default 5174). See README.md.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT || 5174);
const external = process.env.E2E_BASE_URL;
const frontendDir = path.resolve(process.env.FRONTEND_DIR || '../frontend');

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: external || `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: external ? undefined : {
    command: `npx vite --config "${path.resolve('e2e/vite.e2e.config.mjs')}" --port ${port}`,
    cwd: frontendDir,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
