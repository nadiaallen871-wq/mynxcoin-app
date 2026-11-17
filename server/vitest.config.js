import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';

// Load .env.test (when present) before any module reads process.env.
// CI provides the same variables directly.
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
  );
}

// Assigned to process.env (not only test.env) so globalSetup and the Prisma CLI
// subprocess it spawns also use the test database. Existing vars (CI) win.
const testEnv = { NODE_ENV: 'test', ...loadEnvFile('.env.test') };
for (const [key, value] of Object.entries(testEnv)) process.env[key] ??= value;
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.js'],
    fileParallelism: false,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Process entry points are exercised by the E2E suite, not unit/integration tests.
      exclude: ['src/server.js', 'src/worker.js'],
      reporter: ['text-summary', 'json-summary', 'html'],
      // Floors a little below the measured values (statements 86%, branches 74%, functions 87%, lines 90%),
      // so coverage cannot quietly erode. Raise them as coverage improves.
      thresholds: { statements: 82, branches: 70, functions: 82, lines: 86 },
    },
    hookTimeout: 30_000,
  },
});
