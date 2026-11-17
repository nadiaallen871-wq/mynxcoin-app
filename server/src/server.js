import { createApp } from './app.js';
import { env, logger } from './config/index.js';
import { attachPrismaLogging, prisma } from './db/prisma.js';
import { createRedis } from './db/redis.js';
import { createContainer } from './container.js';
import { QUEUES, createQueue } from './jobs/queues.js';
import { assertGoLiveApproved } from './config/go-live.js';

attachPrismaLogging(logger);
await assertGoLiveApproved({ env, prisma, logger });
const redis = createRedis(env.REDIS_URL);
redis.on('error', (err) => logger.warn({ err: err.message }, 'redis connection error'));

// With queues enabled, outbound messages are delivered by the worker. Otherwise they go inline (single-process dev).
const notificationsQueue = env.ENABLE_QUEUES
  ? createQueue(QUEUES.NOTIFICATIONS, { connection: createRedis(env.REDIS_URL, { forWorker: true }), prefix: env.QUEUE_PREFIX })
  : null;
const container = createContainer({ env, logger, prisma, notificationsQueue });
const app = createApp({ env, logger, prisma, redis, container });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV, mode: env.PLATFORM_MODE }, 'API listening');
  if (env.PLATFORM_MODE === 'sandbox') logger.warn('SANDBOX MODE: no real-money operations are enabled');
});

server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis.quit(), notificationsQueue?.close()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled rejection'));
