import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { buildTestApp } from '../helpers.js';

const TOKEN = 'metrics-token-for-tests-0123456789';

describe('metrics endpoint', () => {
  it('is hidden without the token and reports per-route counts and latency with it', async () => {
    const app = buildTestApp({ prisma, env: { METRICS_TOKEN: TOKEN } });
    await request(app).get('/api/v1/health').expect(200);
    await request(app).get('/api/v1/investments/no-such-product').expect(404);
    await request(app).get('/api/v1/health/metrics').expect(404);
    await request(app).get('/api/v1/health/metrics').set('Authorization', 'Bearer wrong-token-wrong-token-xx').expect(404);
    const res = await request(app).get('/api/v1/health/metrics').set('Authorization', `Bearer ${TOKEN}`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/mynx_http_requests_total\{method="GET",route="\/api\/v1\/health\/",status="2xx"\} 1/);
    expect(res.text).toMatch(/route="\/api\/v1\/investments\/:slug",status="4xx"/);
    expect(res.text).not.toContain('no-such-product'); // route patterns only, never raw URLs
    expect(res.text).toMatch(/mynx_http_request_duration_ms_count\{method="GET",route="\/api\/v1\/health\/"\} 1/);
    expect(res.text).toMatch(/mynx_process_resident_memory_bytes \d+/);
  });

  it('stays disabled when no token is configured', async () => {
    const app = buildTestApp({ prisma });
    await request(app).get('/api/v1/health/metrics').set('Authorization', 'Bearer anything-anything-anything').expect(404);
  });
});
