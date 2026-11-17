/**
 * Performance smoke test: concurrent requests to the busiest read endpoints, in-process,
 * against the TEST database. Prints p50/p95/max latency per endpoint and exits non-zero
 * if any p95 exceeds the budget. It is a regression alarm, not a capacity test: real
 * capacity must be measured on staging hardware with production-like data.
 *
 *   npm run perf:smoke -w server            (uses server/.env.test)
 *   PERF_REQUESTS=400 PERF_CONCURRENCY=40 npm run perf:smoke -w server
 */
import { performance } from 'node:perf_hooks';

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('perf:smoke only runs against a *_test database');

const REQUESTS = Number(process.env.PERF_REQUESTS ?? 200);
const CONCURRENCY = Number(process.env.PERF_CONCURRENCY ?? 20);
const BUDGET_P95_MS = Number(process.env.PERF_BUDGET_P95_MS ?? 500);

const { prisma } = await import('../src/db/prisma.js');
const { seed } = await import('../src/db/seed.js');
const { buildTestApp } = await import('../tests/helpers.js');
const { verifiedInvestor, deposit } = await import('../tests/payment-helpers.js');
const { createStaffClient } = await import('../tests/auth-helpers.js');

await seed(prisma);
const app = buildTestApp({ prisma, env: { RATE_LIMIT_MAX: '1000000', HEAVY_RATE_LIMIT_MAX: '1000000' } });
const investor = await verifiedInvestor(app);
await deposit(investor, '1000.00');
const staff = await createStaffClient(['SUPER_ADMIN'], app);

const ENDPOINTS = [
  ['investor', 'GET /portfolio/dashboard', (c) => c.get('/api/v1/portfolio/dashboard')],
  ['investor', 'GET /wallet', (c) => c.get('/api/v1/wallet')],
  ['investor', 'GET /portfolio/history', (c) => c.get('/api/v1/portfolio/history')],
  ['investor', 'GET /notifications', (c) => c.get('/api/v1/notifications')],
  ['investor', 'GET /investments (catalogue)', (c) => c.get('/api/v1/investments')],
  ['staff', 'GET /admin/overview', (c) => c.get('/api/v1/admin/overview')],
  ['staff', 'GET /admin/audit', (c) => c.get('/api/v1/admin/audit?pageSize=50')],
];

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
let failed = false;
console.log(`${REQUESTS} requests per endpoint, ${CONCURRENCY} concurrent, p95 budget ${BUDGET_P95_MS} ms\n`);
for (const [who, name, fire] of ENDPOINTS) {
  const client = who === 'staff' ? staff.client : investor.client;
  await fire(client); // warm up
  const times = [];
  let errors = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < REQUESTS) {
        next += 1;
        const t = performance.now();
        const res = await fire(client);
        times.push(performance.now() - t);
        if (res.status >= 400) errors += 1;
      }
    }),
  );
  times.sort((a, b) => a - b);
  const p95 = pct(times, 95);
  const over = p95 > BUDGET_P95_MS || errors > 0;
  failed ||= over;
  console.log(
    `${over ? 'FAIL' : ' ok '}  ${name.padEnd(30)} p50 ${pct(times, 50).toFixed(0).padStart(5)} ms   p95 ${p95.toFixed(0).padStart(5)} ms   max ${times.at(-1).toFixed(0).padStart(5)} ms   errors ${errors}`,
  );
}
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
