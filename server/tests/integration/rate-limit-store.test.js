import { afterAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRedis } from '../../src/db/redis.js';
import { RedisRateLimitStore } from '../../src/middleware/rate-limit-store.js';
import { rateLimiter } from '../../src/middleware/security.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { testLogger } from '../helpers.js';

const redis = createRedis(process.env.REDIS_URL);
const prefix = `mynx-test:rl:${process.pid}:${Date.now()}:`;
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(keys);
  await redis.quit();
});

const build = () => {
  const app = express();
  app.use(rateLimiter({ windowMs: 60_000, limit: 2, store: new RedisRateLimitStore({ client: redis, prefix }) }));
  app.get('/', (_req, res) => res.send('ok'));
  app.use(errorHandler({ logger: testLogger }));
  return app;
};

describe('Redis rate-limit store', () => {
  it('shares counts across app instances (as with multiple API replicas)', async () => {
    await request(build()).get('/').expect(200);
    await request(build()).get('/').expect(200);
    const res = await request(build()).get('/').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    const keys = await redis.keys(`${prefix}*`);
    expect(await redis.pttl(keys[0])).toBeGreaterThan(0);
  });
});
