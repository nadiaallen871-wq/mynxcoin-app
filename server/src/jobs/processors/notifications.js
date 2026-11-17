import { DELIVER_MESSAGE_JOB } from '../../modules/notifications/messaging.service.js';

export const SWEEP_JOB = 'sweep-stale-messages';
export const SWEEP_EVERY_MS = 60_000;

/** Delivers outbox messages. A failed delivery is retried by BullMQ with backoff. */
export function notificationProcessors({ messaging }) {
  return {
    [DELIVER_MESSAGE_JOB]: async (job) => {
      const message = await messaging.deliver(job.data.messageId);
      return { status: message?.status ?? 'missing' };
    },
    // Picks up messages whose enqueue failed after commit (e.g. Redis briefly unavailable).
    [SWEEP_JOB]: async () => ({ redispatched: await messaging.redispatchStale() }),
  };
}
