import { defineConfig, devices } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Browser end-to-end tests. Playwright starts its own API (port 4100, TEST database) and
 * client (port 5174), so it never touches development data. Run with `npm run test:e2e`.
 */
const root = join(import.meta.dirname, '..');
const envFile = join(root, 'server', '.env.test');
const fileEnv = existsSync(envFile)
  ? Object.fromEntries(
      readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    )
  : {};
const API_PORT = '4100';
const WEB_PORT = '5174';
export const WEB_URL = `http://localhost:${WEB_PORT}`;

const apiEnv = {
  ...fileEnv,
  ...process.env,
  NODE_ENV: 'test',
  PORT: API_PORT,
  APP_BASE_URL: WEB_URL,
  CORS_ORIGINS: WEB_URL,
  ENABLE_QUEUES: 'false',
};
// The global setup builds fixtures in the same database the API uses.
Object.assign(process.env, apiEnv);

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js$/,
  globalSetup: './global-setup.js',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /public\.spec\.js$/ },
  ],
  webServer: [
    {
      command: 'node src/server.js',
      cwd: join(root, 'server'),
      env: apiEnv,
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The production bundle, served by `vite preview` (which reuses the dev proxy to the API).
      command: `npm run build && npx vite preview --port ${WEB_PORT} --strictPort`,
      cwd: join(root, 'client'),
      env: { ...process.env, VITE_API_PROXY: `http://localhost:${API_PORT}` },
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
