import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { assertGoLiveApproved } from '../../src/config/go-live.js';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  CORS_ORIGINS: 'https://app.example.com',
  SESSION_SECRET: 'a-production-length-session-secret-0000000',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const logger = { fatal: () => {}, warn: () => {} };
const prismaWith = (value) => ({ systemSetting: { findUnique: async () => (value === undefined ? null : { value }) } });

describe('live mode gates', () => {
  it('refuses live mode while email, SMS or screening use sandbox adapters', () => {
    expect(() => loadEnv({ ...base, PLATFORM_MODE: 'live', PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_live_x' })).toThrow(
      /EMAIL_PROVIDER|SMS_PROVIDER|SCREENING_PROVIDER/,
    );
  });

  it('starts in sandbox mode regardless of the go-live setting', async () => {
    await expect(
      assertGoLiveApproved({ env: { PLATFORM_MODE: 'sandbox' }, prisma: prismaWith(undefined), logger }),
    ).resolves.toBeUndefined();
  });

  it('refuses to start in live mode unless go-live is approved', async () => {
    await expect(assertGoLiveApproved({ env: { PLATFORM_MODE: 'live' }, prisma: prismaWith(false), logger })).rejects.toThrow(
      /not approved/,
    );
    await expect(assertGoLiveApproved({ env: { PLATFORM_MODE: 'live' }, prisma: prismaWith(undefined), logger })).rejects.toThrow(
      /not approved/,
    );
    await expect(assertGoLiveApproved({ env: { PLATFORM_MODE: 'live' }, prisma: prismaWith(true), logger })).resolves.toBeUndefined();
  });
});
