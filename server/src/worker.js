import { env, logger } from './config/index.js';
import { createRedis } from './db/redis.js';
import { prisma } from './db/prisma.js';
import { createContainer } from './container.js';
import { QUEUES, createQueue } from './jobs/queues.js';
import { createWorker } from './jobs/worker-factory.js';
import { assertGoLiveApproved } from './config/go-live.js';
import { HEARTBEAT_EVERY_MS, HEARTBEAT_JOB, systemProcessors } from './jobs/processors/system.js';
import { SWEEP_EVERY_MS, SWEEP_JOB, notificationProcessors } from './jobs/processors/notifications.js';
import {
  IDEMPOTENCY_CLEANUP_JOB,
  LEDGER_RECONCILIATION_JOB,
  MATURITY_FLAG_JOB,
  PENDING_PAYMENTS_JOB,
  reconciliationProcessors,
} from './jobs/processors/reconciliation.js';

await assertGoLiveApproved({ env, prisma, logger });

/**
 * Background worker process, run separately from the API (`npm run worker`).
 * Queues: system (heartbeat), notifications (outbox delivery plus a stale sweep) and
 * reconciliation (daily ledger integrity check, idempotency cleanup).
 */
const connection = createRedis(env.REDIS_URL, { forWorker: true });
const stateRedis = createRedis(env.REDIS_URL);
const prefix = env.QUEUE_PREFIX;

const systemQueue = createQueue(QUEUES.SYSTEM, { connection, prefix });
const notificationsQueue = createQueue(QUEUES.NOTIFICATIONS, { connection, prefix });
const reconciliationQueue = createQueue(QUEUES.RECONCILIATION, { connection, prefix });
await systemQueue.upsertJobScheduler('system-heartbeat', { every: HEARTBEAT_EVERY_MS }, { name: HEARTBEAT_JOB });
await notificationsQueue.upsertJobScheduler('notifications-sweep', { every: SWEEP_EVERY_MS }, { name: SWEEP_JOB });
// 02:00 UTC daily integrity check; hourly idempotency cleanup.
await reconciliationQueue.upsertJobScheduler(
  'ledger-integrity-daily',
  { pattern: '0 2 * * *', tz: 'UTC' },
  { name: LEDGER_RECONCILIATION_JOB },
);
await reconciliationQueue.upsertJobScheduler('idempotency-cleanup-hourly', { every: 3_600_000 }, { name: IDEMPOTENCY_CLEANUP_JOB });
await reconciliationQueue.upsertJobScheduler('pending-payments-5m', { every: 300_000 }, { name: PENDING_PAYMENTS_JOB });
await reconciliationQueue.upsertJobScheduler('maturity-flag-daily', { pattern: '0 1 * * *', tz: 'UTC' }, { name: MATURITY_FLAG_JOB });

const container = createContainer({ env, logger, prisma, notificationsQueue });

const workers = [
  createWorker(QUEUES.SYSTEM, systemProcessors({ redis: stateRedis, prefix }), { connection, prefix, logger }),
  createWorker(QUEUES.NOTIFICATIONS, notificationProcessors({ messaging: container.messaging }), { connection, prefix, logger }),
  createWorker(
    QUEUES.RECONCILIATION,
    reconciliationProcessors({ reconciliation: container.reconciliation, prisma, deposits: container.deposits, orders: container.orders }),
    {
      connection,
      prefix,
      logger,
      concurrency: 1,
    },
  ),
];

logger.info({ queues: [QUEUES.SYSTEM, QUEUES.NOTIFICATIONS, QUEUES.RECONCILIATION], mode: env.PLATFORM_MODE }, 'worker started');

async function shutdown(signal) {
  logger.info({ signal }, 'worker shutting down');
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([systemQueue.close(), notificationsQueue.close(), reconciliationQueue.close()]);
  await Promise.allSettled([connection.quit(), stateRedis.quit(), prisma.$disconnect()]);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
