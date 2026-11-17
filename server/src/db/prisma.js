import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma client per process. Financial services must receive a
 * transaction client (`tx`) from `prisma.$transaction(...)` rather than
 * importing this directly, so multi-step operations stay atomic.
 */
export const prisma = new PrismaClient({
  // Default interactive-transaction limits are 2 s to start and 5 s to finish. Under a slow disk or a
  // cold cache that turned sign-ins into 500s, so allow a little more before giving up.
  transactionOptions: { maxWait: 5_000, timeout: 15_000 },
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

export function attachPrismaLogging(logger) {
  prisma.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
  prisma.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'));
}

export async function checkDatabase() {
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return { latencyMs: Date.now() - started };
}
