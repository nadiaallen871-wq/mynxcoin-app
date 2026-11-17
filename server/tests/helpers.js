import { createApp } from '../src/app.js';
import { createLogger } from '../src/config/logger.js';
import { loadEnv } from '../src/config/env.js';

export const testLogger = createLogger({ level: 'silent' });

/** Builds an app with real config and injectable fakes for infrastructure. */
export function buildTestApp(overrides = {}) {
  const env = loadEnv({ ...process.env, ...(overrides.env ?? {}) });
  return createApp({
    env,
    logger: testLogger,
    prisma: overrides.prisma,
    redis: overrides.redis,
    healthService: overrides.healthService,
    platformService: overrides.platformService,
  });
}
