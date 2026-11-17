# Testing

| Layer                       | Tool                                               | Command                                | What it covers                                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server unit and integration | Vitest + Supertest, real PostgreSQL                | `npm test -w server`                   | ~300 tests. Every module through its HTTP API against a real database, plus pure unit tests (money, PDF writer, state machines, config)                                                                                      |
| Server coverage             | `@vitest/coverage-v8`                              | `npm run test:coverage -w server`      | Fails below 82% statements, 70% branches, 82% functions, 86% lines (measured: 87 / 74 / 87 / 91)                                                                                                                             |
| Client                      | Vitest + Testing Library (jsdom)                   | `npm test -w client`                   | Forms, money input, guards, navigation, accessible names                                                                                                                                                                     |
| Browser end-to-end          | Playwright (Chromium; desktop and mobile profiles) | `npm run test:e2e`                     | Public pages (heading, sandbox notice, no sideways scroll, labelled fields), and the money journey: deposit through the sandbox checkout → withdrawal → Finance Officer MFA sign-in and approval → investor sees it paid out |
| Performance smoke           | `server/scripts/perf-smoke.js`                     | `npm run perf:smoke -w server`         | p50/p95/max under 20 concurrent requests on the busiest endpoints; fails if any p95 exceeds 500 ms                                                                                                                           |
| Backup and restore          | `infrastructure/backup/restore-drill.mjs`          | `npm run backup:drill`                 | Encrypted dump → restore into a scratch database → row counts and ledger checks                                                                                                                                              |
| Static checks               | ESLint, Prettier, `npm audit`                      | `npm run lint`, `npm run format:check` | Includes a rule banning float parsing in money modules                                                                                                                                                                       |

## Test databases

Server tests, E2E and the performance smoke run only against a database whose name ends in `_test`
(`server/.env.test`); every runner refuses anything else. Tests create their own users and products and tolerate rows
left by earlier runs, so the local test database is never wiped automatically. To start clean, run
`npx prisma migrate reset` in `server/` yourself.

Playwright starts its own API (port 4100) and production client build (`vite preview`, port 5174) against the test
database. Its global setup creates fresh accounts for each run. Reports go to `playwright-report/`.

## What is tested where (highlights)

- **Authorization sweep** (`security-sweep.test.js`): reads every route from the source and checks that each non-public
  route returns 401 without a session and each `/admin` route returns 403 to an investor. A new endpoint is covered the
  day it is added.
- **Money concurrency** (`critical-paths.test.js`, `ledger.test.js`, `orders.test.js`):
  - the same FX quote submitted five times at once converts once
  - racing withdrawals cannot overdraw
  - concurrent reservations, capacity under concurrency, and simultaneous duplicate idempotency keys
- **Replay safety:**
  - webhook replays and bad signatures (`payments.test.js`)
  - expired and mismatched idempotency keys (`critical-paths.test.js`)
  - single-use quotes and approval requests
- **Ledger integrity:** most money tests end with a reconciliation run that must pass. Tamper detection is proven in
  `ledger.test.js`.
- **Maker-checker:** requester ≠ decider, stale requests fail instead of applying, permission per approval type
  (`administration.test.js`, `advanced.test.js`).
- **Live-mode gates** (`go-live.test.js`).

## CI

`.github/workflows/ci.yml` runs on every push to `main`, every pull request and weekly.

- **verify job:**
  - lint, format, migrations applied from scratch, and a schema drift check
  - server tests with coverage thresholds, client tests, production build
  - performance smoke and the backup/restore drill
  - production dependency audit
- **e2e job:** Playwright on Chromium. The report is uploaded as an artifact.
- **images job:** builds both Docker images (not pushed).

The e2e, images and restore-drill steps were added in Phase 10. They run locally (except the image builds: Docker is
not installed on the development machine) but **have not yet run on GitHub Actions**; the first push will be their first
CI run.

## Known flakiness

- The Phase 7 dashboard test (`investor-experience.test.js`, "builds the dashboard") has failed in two full-suite runs
  (Phase 9, and once on 2026-11-14). It passed 3 of 3 times on its own and in the next full runs. The assertion that
  failed was not captured, so the cause is still unknown. It is probably order- or timing-dependent. Capture the
  assertion the next time it fails.
- On 2026-11-14 one full run lost its database connection mid-file (`ledger.test.js`). The Postgres log showed a
  checkpoint taking 303 s with a 33 s fsync, which points to a local disk stall. The file passed 17/17 on re-run.
- One E2E run in Phase 10 failed in setup when a database transaction exceeded 15 s. This was right after a full
  coverage run on the same two-core machine, and it passed on re-run.
