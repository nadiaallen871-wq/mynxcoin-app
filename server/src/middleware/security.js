import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/errors.js';

/** Helmet with a strict CSP. The API serves JSON only, so nothing is allowed to load. */
export function securityHeaders({ isProduction }) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: isProduction ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
  });
}

/** CORS with an explicit allowlist. Requests without an Origin header (curl, server-to-server) pass. */
export function corsPolicy({ origins }) {
  const allow = new Set(origins);
  return cors({
    origin(origin, callback) {
      if (!origin || allow.has(origin)) return callback(null, true);
      const err = new Error('Origin not allowed');
      err.code = 'CORS_REJECTED';
      return callback(err);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: 600,
  });
}

/**
 * Rate limiter factory. Pass a RedisRateLimitStore (middleware/rate-limit-store.js)
 * so limits are shared across API instances. Without one, the in-memory store is used (tests).
 */
export function rateLimiter({ windowMs, limit, name = 'global', store, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit,
    ...(store ? { store } : {}),
    ...(keyGenerator ? { keyGenerator } : {}),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: name,
    handler: (_req, _res, next) => next(new AppError('Too many requests, please slow down', { status: 429, code: 'RATE_LIMITED' })),
  });
}
