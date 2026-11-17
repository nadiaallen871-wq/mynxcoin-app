import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueueEvents } from 'bullmq';
import { createRedis } from '../../src/db/redis.js';
import { createQueue, deadLetterName, enqueueOnce } from '../../src/jobs/queues.js';
import { UnrecoverableError, createWorker } from '../../src/jobs/worker-factory.js';
import { HEARTBEAT_JOB, HEARTBEAT_KEY, systemProcessors } from '../../src/jobs/processors/system.js';
import { testLogger } from '../helpers.js';

const prefix = `mynx-test-${process.pid}`;
const connection = createRedis(process.env.REDIS_URL, { forWorker: true });
const redis = createRedis(process.env.REDIS_URL);
const name = 'test-queue';
let queue;
let events;
let handle;
const calls = { ok: 0, flaky: 0 };

beforeAll(async () => {
  queue = createQueue(name, { connection, prefix });
  events = new QueueEvents(name, { connection: createRedis(process.env.REDIS_URL, { forWorker: true }), prefix });
  await events.waitUntilReady();
  handle = createWorker(
    name,
    {
      ...systemProcessors({ redis, prefix }),
      ok: async (job) => {
        calls.ok += 1;
        return { echoed: job.data.value };
      },
      flaky: async () => {
        calls.flaky += 1;
        if (calls.flaky < 2) throw new Error('transient');
        return 'recovered';
      },
      fatal: async () => {
        throw new UnrecoverableError('bad payload');
      },
    },
    { connection, prefix, logger: testLogger },
  );
});

afterAll(async () => {
  await handle.close();
  await queue.obliterate({ force: true });
  await handle.dlq.obliterate?.({ force: true }).catch(() => {});
  await queue.close();
  await events.close();
  await redis.del(HEARTBEAT_KEY(prefix));
  await Promise.all([connection.quit(), redis.quit()]);
});

describe('BullMQ infrastructure', () => {
  it('processes jobs', async () => {
    const job = await queue.add('ok', { value: 42 });
    expect(await job.waitUntilFinished(events, 10_000)).toEqual({ echoed: 42 });
  });

  it('deduplicates jobs with the same idempotency key', async () => {
    const before = calls.ok;
    const a = await enqueueOnce(queue, 'ok', { value: 1 }, 'evt-123');
    const b = await enqueueOnce(queue, 'ok', { value: 2 }, 'evt-123');
    expect(a.id).toBe(b.id);
    await a.waitUntilFinished(events, 10_000);
    expect(calls.ok - before).toBe(1);
    await expect(enqueueOnce(queue, 'ok', {}, '')).rejects.toThrow(/idempotency key/);
  });

  it('retries transient failures with backoff', async () => {
    const job = await queue.add('flaky', {}, { attempts: 3, backoff: { type: 'fixed', delay: 50 } });
    expect(await job.waitUntilFinished(events, 10_000)).toBe('recovered');
  });

  it('moves unrecoverable failures to the dead-letter queue', async () => {
    const job = await queue.add('fatal', { orderId: 'o-1' });
    await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow('bad payload');
    let dead;
    for (let i = 0; i < 40 && !dead; i++) {
      dead = await handle.dlq.getJob(`dlq__${job.id}`);
      if (!dead) await new Promise((r) => setTimeout(r, 50));
    }
    expect(handle.dlq.name).toBe(deadLetterName(name));
    expect(dead.data).toMatchObject({ originalJobId: job.id, data: { orderId: 'o-1' }, failedReason: 'bad payload' });
  });

  it('records the worker heartbeat', async () => {
    const job = await queue.add(HEARTBEAT_JOB, {});
    await job.waitUntilFinished(events, 10_000);
    expect(await redis.get(HEARTBEAT_KEY(prefix))).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
