import { z } from 'zod';

/**
 * Environment configuration, validated once at startup.
 * The process refuses to boot with an invalid or unsafe configuration.
 */
const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),

    // Explicit allowlist of browser origins. A wildcard is never accepted.
    CORS_ORIGINS: csv,
    APP_BASE_URL: z.string().url().default('http://localhost:5173'),

    // Sandbox is the only mode permitted until go-live prerequisites are met.
    PLATFORM_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    /** Per-user limit per minute for expensive actions (document generation, uploads, quotes, exports). */
    HEAVY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    /** Bearer token for GET /api/v1/health/metrics. The endpoint is disabled (404) when unset. */
    METRICS_TOKEN: z.string().min(24).optional(),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_IDLE_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(30),
    SESSION_ABSOLUTE_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .default(12),

    // 32-byte key (base64) for encrypting data at rest (TOTP secrets).
    ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64-encoded'),

    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    // Account lockout: after N consecutive failed passwords the account is locked for M minutes.
    LOCKOUT_THRESHOLD: z.coerce.number().int().min(3).max(20).default(5),
    LOCKOUT_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(15),
    MFA_ISSUER: z.string().min(1).max(40).default('Mynx'),

    // Messaging providers. "sandbox" stores messages in the outbox without sending them.
    EMAIL_PROVIDER: z.enum(['sandbox']).default('sandbox'),
    SMS_PROVIDER: z.enum(['sandbox']).default('sandbox'),

    // Private document storage. "local" keeps AES-256-GCM encrypted files on disk
    // outside any web root. An S3-compatible driver plugs into the same interface.
    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('storage/private'),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(100_000)
      .max(25 * 1024 * 1024)
      .default(10 * 1024 * 1024),
    DOCUMENT_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
    // Sanctions/PEP screening. "sandbox" matches only documented test names.
    SCREENING_PROVIDER: z.enum(['sandbox']).default('sandbox'),

    // Payments. "sandbox" simulates a provider end to end (signed webhooks included).
    PAYMENT_PROVIDER: z.enum(['sandbox', 'paystack']).default('sandbox'),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    SANDBOX_WEBHOOK_SECRET: z.string().min(32).optional(),
    // Limits in minor units of the platform currency (GHS: 1000 = GH₵ 10.00).
    DEPOSIT_MIN_MINOR: z.coerce.number().int().positive().default(1_000),
    DEPOSIT_MAX_MINOR: z.coerce.number().int().positive().default(5_000_000),
    WITHDRAWAL_MIN_MINOR: z.coerce.number().int().positive().default(1_000),
    WITHDRAWAL_FEE_MINOR: z.coerce.number().int().min(0).default(0),
    LARGE_WITHDRAWAL_MINOR: z.coerce.number().int().positive().default(1_000_000),

    QUEUE_PREFIX: z.string().default('mynx'),
    ENABLE_QUEUES: bool,
  })
  .superRefine((env, ctx) => {
    if (env.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Wildcard origins are not allowed' });
    }
    if (env.PAYMENT_PROVIDER === 'paystack' && !env.PAYSTACK_SECRET_KEY) {
      ctx.addIssue({ code: 'custom', path: ['PAYSTACK_SECRET_KEY'], message: 'Required when PAYMENT_PROVIDER=paystack' });
    }
    // Live keys can never be used while the platform is in sandbox mode.
    if (env.PLATFORM_MODE === 'sandbox' && env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_')) {
      ctx.addIssue({ code: 'custom', path: ['PAYSTACK_SECRET_KEY'], message: 'Live payment keys are not allowed in sandbox mode' });
    }
    if (env.PLATFORM_MODE === 'live' && env.PAYMENT_PROVIDER === 'sandbox') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'The sandbox payment provider cannot be used in live mode' });
    }
    if (env.DEPOSIT_MAX_MINOR < env.DEPOSIT_MIN_MINOR) {
      ctx.addIssue({ code: 'custom', path: ['DEPOSIT_MAX_MINOR'], message: 'Must be at least DEPOSIT_MIN_MINOR' });
    }
    if (env.PLATFORM_MODE === 'live' && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['PLATFORM_MODE'],
        message: 'Live mode may only be used with NODE_ENV=production',
      });
    }
    if (env.PLATFORM_MODE === 'live') {
      // Live mode needs real providers. Only sandbox adapters exist for these today, so live mode
      // cannot start until each has a contracted, implemented adapter (see production-readiness.md).
      for (const key of ['EMAIL_PROVIDER', 'SMS_PROVIDER', 'SCREENING_PROVIDER']) {
        if (env[key] === 'sandbox') ctx.addIssue({ code: 'custom', path: [key], message: 'Sandbox providers cannot be used in live mode' });
      }
    }
    if (env.NODE_ENV === 'production') {
      if (env.SESSION_SECRET.includes('change-me')) {
        ctx.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'Default secret used in production' });
      }
      if (env.CORS_ORIGINS.some((origin) => origin.startsWith('http://'))) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Production origins must use https' });
      }
    }
  });

export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return Object.freeze(result.data);
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
