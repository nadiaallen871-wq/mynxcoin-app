import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';
import { buildTestApp, testLogger } from '../helpers.js';
import { prisma } from '../../src/db/prisma.js';
import { createRedis } from '../../src/db/redis.js';
import { validate } from '../../src/middleware/validate.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { requestId } from '../../src/middleware/request-id.js';
import { seed } from '../../src/db/seed.js';

const redis = createRedis(process.env.REDIS_URL);
const app = buildTestApp({ prisma, redis });

afterAll(async () => {
  await redis.quit();
  await prisma.$disconnect();
});

describe('health endpoints (real PostgreSQL and Redis)', () => {
  it('GET /api/v1/health reports liveness', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/v1/health/ready checks database and redis', async () => {
    const res = await request(app).get('/api/v1/health/ready').expect(200);
    expect(res.body.checks.database.status).toBe('up');
    expect(res.body.checks.redis.status).toBe('up');
    expect(['ok', 'degraded']).toContain(res.body.status);
  });

  it('returns 503 when the database is unreachable', async () => {
    const failing = buildTestApp({
      redis,
      healthService: (await import('../../src/modules/health/health.service.js')).createHealthService({
        redis,
        queuePrefix: 'mynx-test',
        dbCheck: async () => {
          throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
        },
      }),
    });
    const res = await request(failing).get('/api/v1/health/ready').expect(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks.database).toEqual({ status: 'down', error: 'ECONNREFUSED' });
  });
});

describe('platform info', () => {
  it('reports sandbox mode and active currencies from the database', async () => {
    await seed(prisma);
    const res = await request(app).get('/api/v1/platform').expect(200);
    expect(res.body.data.mode).toBe('sandbox');
    expect(res.body.data.realMoneyEnabled).toBe(false);
    expect(res.body.data.disclosure).toMatch(/simulated/);
    expect(res.body.data.currencies).toEqual([{ code: 'GHS', name: 'Ghana Cedi', symbol: 'GH₵', minorUnits: 2 }]);
  });
});

describe('security middleware', () => {
  it('sets secure headers and hides the framework', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('allows listed CORS origins with credentials', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects unlisted CORS origins with the standard error envelope', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example').expect(403);
    expect(res.body.error.code).toBe('CORS_REJECTED');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('assigns a request id, or reuses a well-formed inbound one', async () => {
    const generated = await request(app).get('/api/v1/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const reused = await request(app).get('/api/v1/health').set('X-Request-Id', 'trace-12345678');
    expect(reused.headers['x-request-id']).toBe('trace-12345678');
    const rejected = await request(app).get('/api/v1/health').set('X-Request-Id', 'bad id <script>');
    expect(rejected.headers['x-request-id']).not.toContain('<');
  });

  it('rate limits API routes', async () => {
    const limited = buildTestApp({ prisma, redis, env: { RATE_LIMIT_MAX: '2' } });
    await request(limited).get('/api/v1/platform').expect(200);
    await request(limited).get('/api/v1/platform').expect(200);
    const res = await request(limited).get('/api/v1/platform').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('error envelope', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app).post('/api/v1/platform').set('Content-Type', 'application/json').send('{"bad"');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('never leaks internal error details on 5xx', async () => {
    const mini = express();
    mini.use(requestId());
    mini.get('/boom', () => {
      throw new Error('connection string postgres://secret@db');
    });
    mini.use(errorHandler({ logger: testLogger }));
    const res = await request(mini).get('/boom').expect(500);
    expect(res.body.error.message).toBe('An unexpected error occurred');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('validates requests and reports each issue', async () => {
    const mini = express();
    mini.use(express.json());
    mini.use(requestId());
    mini.post('/v', validate({ body: z.object({ amount: z.string().regex(/^\d+$/), currency: z.enum(['GHS']) }) }), (req, res) =>
      res.json(req.body),
    );
    mini.use(errorHandler({ logger: testLogger }));

    const bad = await request(mini).post('/v').send({ amount: '1.5', currency: 'XYZ' }).expect(422);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.details.map((d) => d.path).sort()).toEqual(['amount', 'currency']);

    await request(mini).post('/v').send({ amount: '150', currency: 'GHS' }).expect(200);
  });
});
