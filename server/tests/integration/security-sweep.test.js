import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers.js';
import { createClient } from '../auth-helpers.js';
import { verifiedInvestor } from '../payment-helpers.js';

/**
 * Authorization sweep. The route list is read from the source (every `r.<method>('<path>'`
 * inside every `export function <name>Routes`, joined with its mount point in app.js), so a
 * new endpoint is covered the day it is added. Each route must:
 *   - reject a signed-out caller with 401, unless it is on the short public list below
 *   - refuse an ordinary investor on every /admin route
 */
const SRC = join(import.meta.dirname, '../../src');
const UUID = '00000000-0000-4000-8000-000000000000';

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.routes.js') ? [p] : [];
  });
}

function discoverRoutes() {
  const app = readFileSync(join(SRC, 'app.js'), 'utf8');
  const mounts = {};
  for (const m of app.matchAll(/api\.use\(\s*'([^']+)',\s*(\w+Routes)\(/g)) (mounts[m[2]] ??= []).push(m[1]);
  const routes = [];
  for (const file of walk(join(SRC, 'modules'))) {
    const text = readFileSync(file, 'utf8');
    const fns = [...text.matchAll(/export function (\w+Routes)\(/g)].map((m) => ({ name: m[1], at: m.index }));
    for (const m of text.matchAll(/\b(?:r|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
      const fn = fns.filter((f) => f.at < m.index).at(-1);
      for (const prefix of mounts[fn?.name] ?? []) {
        if (prefix === '/dev') continue; // development only, not mounted in tests
        const path = `${prefix}${m[2] === '/' ? '' : m[2]}`.replace(/:(\w+)/g, (_, p) =>
          p === 'key' || p === 'slug' || p === 'code' || p === 'kind' || p === 'provider' || p === 'reference' ? 'sample' : UUID,
        );
        routes.push({ method: m[1], path: `/api/v1${path}` });
      }
    }
  }
  return routes;
}

/** Endpoints that are meant to work without a session. Everything else must demand one. */
const PUBLIC = [
  /^\/api\/v1\/health/,
  /^\/api\/v1\/platform$/,
  /^\/api\/v1\/auth\/(csrf|register|login|logout|verify-email|resend-verification|forgot-password|reset-password)$/,
  /^\/api\/v1\/users\/session$/,
  /^\/api\/v1\/investments$/,
  /^\/api\/v1\/investments\/(categories|calculator|sample|sample\/documents\/[^/]+)$/,
  /^\/api\/v1\/payments\/webhooks\/sample$/,
  /^\/api\/v1\/support\/faqs$/,
];
const isPublic = (path) => PUBLIC.some((re) => re.test(path));

let app;
let routes;
let anonymous;
let investor;

beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
  routes = discoverRoutes();
  anonymous = await createClient(app);
  investor = await verifiedInvestor(app);
});
afterAll(() => prisma.$disconnect());

const call = (client, { method, path }) => (method === 'get' ? client.get(path) : client[method](path).send({}));

describe('authorization sweep over every API route', () => {
  it('finds the whole API', () => {
    expect(routes.length).toBeGreaterThan(180);
    expect(routes.some((r) => r.path === '/api/v1/admin/overview')).toBe(true);
    expect(routes.some((r) => r.path === '/api/v1/fx/conversions' && r.method === 'post')).toBe(true);
  });

  it('demands a session everywhere except the listed public endpoints', async () => {
    const leaks = [];
    for (const route of routes.filter((r) => !isPublic(r.path))) {
      const res = await call(anonymous, route);
      if (res.status !== 401) leaks.push(`${route.method.toUpperCase()} ${route.path} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('refuses an investor on every admin endpoint', async () => {
    const leaks = [];
    for (const route of routes.filter((r) => r.path.startsWith('/api/v1/admin'))) {
      const res = await call(investor.client, route);
      if (res.status !== 403) leaks.push(`${route.method.toUpperCase()} ${route.path} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('never answers a state-changing request without the CSRF token', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/v1/wallet/deposits').send({ amount: '10.00' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toMatch(/CSRF/);
  });
});
