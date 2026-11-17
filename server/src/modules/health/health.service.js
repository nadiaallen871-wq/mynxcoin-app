import { checkDatabase } from '../../db/prisma.js';
import { checkRedis } from '../../db/redis.js';
import { HEARTBEAT_EVERY_MS, HEARTBEAT_KEY } from '../../jobs/processors/system.js';

const WORKER_STALE_MS = HEARTBEAT_EVERY_MS * 4;

async function probe(fn) {
  try {
    return { status: 'up', ...(await fn()) };
  } catch (err) {
    return { status: 'down', error: err.code ?? err.name ?? 'Error' };
  }
}

export function createHealthService({ redis, queuePrefix, dbCheck = checkDatabase }) {
  return {
    liveness() {
      return { status: 'ok', uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() };
    },

    /**
     * Database and Redis are required for readiness. A stale worker heartbeat
     * reports "degraded" without failing readiness: the API can still serve reads.
     */
    async readiness() {
      const [database, cache] = await Promise.all([probe(dbCheck), probe(() => checkRedis(redis))]);

      let worker = { status: 'unknown' };
      if (cache.status === 'up') {
        const last = await redis.get(HEARTBEAT_KEY(queuePrefix)).catch(() => null);
        if (!last) worker = { status: 'down', lastHeartbeat: null };
        else {
          const ageMs = Date.now() - Date.parse(last);
          worker = { status: ageMs <= WORKER_STALE_MS ? 'up' : 'stale', lastHeartbeat: last };
        }
      }

      const ready = database.status === 'up' && cache.status === 'up';
      const status = !ready ? 'unavailable' : worker.status === 'up' ? 'ok' : 'degraded';
      return { ready, body: { status, checks: { database, redis: cache, worker }, time: new Date().toISOString() } };
    },
  };
}
