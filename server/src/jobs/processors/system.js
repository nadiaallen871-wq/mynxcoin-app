/**
 * System processors. The heartbeat records the worker's last run in Redis so
 * the API readiness probe can report whether background processing is alive.
 */
export const HEARTBEAT_KEY = (prefix) => `${prefix}:worker:heartbeat`;
export const HEARTBEAT_JOB = 'heartbeat';
export const HEARTBEAT_EVERY_MS = 30_000;

export function systemProcessors({ redis, prefix }) {
  return {
    [HEARTBEAT_JOB]: async () => {
      const at = new Date().toISOString();
      await redis.set(HEARTBEAT_KEY(prefix), at, 'EX', 300);
      return { at };
    },
  };
}
