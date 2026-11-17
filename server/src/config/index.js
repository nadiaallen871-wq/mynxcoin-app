import { env, isProduction, isTest } from './env.js';
import { createLogger } from './logger.js';

export { env, isProduction, isTest };

export const logger = createLogger({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  pretty: env.NODE_ENV === 'development',
});
