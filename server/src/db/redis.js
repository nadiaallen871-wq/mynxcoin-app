import { Redis } from 'ioredis';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on connections used by workers.
 * Each component creates its own connection because BullMQ blocks on worker connections.
 */
export function createRedis(url, { forWorker = false, lazy = false } = {}) {
  return new Redis(url, {
    lazyConnect: lazy,
    enableReadyCheck: true,
    maxRetriesPerRequest: forWorker ? null : 2,
    connectTimeout: 5_000,
  });
}

export async function checkRedis(client) {
  const started = Date.now();
  const pong = await client.ping();
  if (pong !== 'PONG') throw new Error(`Unexpected PING reply: ${pong}`);
  return { latencyMs: Date.now() - started };
}
