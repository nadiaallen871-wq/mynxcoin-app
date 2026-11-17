import { Queue } from 'bullmq';

/** Every queue the platform uses. A dead-letter queue is derived per queue. */
export const QUEUES = Object.freeze({
  SYSTEM: 'system',
  NOTIFICATIONS: 'notifications',
  PAYMENTS: 'payments',
  INVESTMENTS: 'investments',
  RECONCILIATION: 'reconciliation',
});

export const deadLetterName = (queueName) => `${queueName}-dead-letter`;

/**
 * Default retry policy: 5 attempts with exponential backoff (2s, 4s, 8s, 16s).
 * Jobs that exhaust their attempts are copied to the dead-letter queue by the worker factory.
 */
export const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
});

export function createQueue(name, { connection, prefix }) {
  return new Queue(name, { connection, prefix, defaultJobOptions: DEFAULT_JOB_OPTIONS });
}

/**
 * Enqueue idempotently. BullMQ ignores an `add` whose jobId already exists, so
 * repeating the same business event (e.g. a webhook replay) never runs twice.
 */
export async function enqueueOnce(queue, jobName, data, idempotencyKey, opts = {}) {
  if (!idempotencyKey) throw new Error('enqueueOnce requires an idempotency key');
  // BullMQ reserves ':' in job IDs, so '__' is the separator.
  return queue.add(jobName, data, { ...opts, jobId: `${jobName}__${idempotencyKey}` });
}
