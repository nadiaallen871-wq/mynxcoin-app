import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createPaystackProvider } from '../../src/integrations/payments/paystack.provider.js';
import { loadEnv } from '../../src/config/env.js';

const SECRET = 'sk_test_0123456789abcdef';
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe('Paystack adapter (mocked HTTP)', () => {
  it('initialises a transaction with amounts in minor units and returns the hosted checkout URL', async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'dep_x' } }),
    );
    const p = createPaystackProvider({ secretKey: SECRET, fetchImpl });
    const r = await p.initializeCollection({
      reference: 'dep_x',
      amountMinor: 12_345n,
      currency: 'GHS',
      email: 'a@b.test',
      callbackUrl: 'https://app/x',
    });
    expect(r.checkoutUrl).toBe('https://checkout.paystack.com/abc');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body)).toMatchObject({ amount: '12345', currency: 'GHS', reference: 'dep_x' });
  });

  it('maps verification responses', async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { status: true, data: { status: 'success', amount: 50000, currency: 'GHS', fees: 975, id: 4242 } }),
    );
    const p = createPaystackProvider({ secretKey: SECRET, fetchImpl });
    expect(await p.verifyCollection('dep_x')).toMatchObject({
      status: 'SUCCEEDED',
      amountMinor: 50_000n,
      feeMinor: 975n,
      providerTransactionId: '4242',
    });
    fetchImpl.mockResolvedValueOnce(json(200, { status: true, data: { status: 'abandoned', amount: 1, currency: 'GHS', id: 1 } }));
    expect((await p.verifyCollection('dep_y')).status).toBe('FAILED');
    fetchImpl.mockResolvedValueOnce(json(200, { status: true, data: { status: 'ongoing', amount: 1, currency: 'GHS', id: 1 } }));
    expect((await p.verifyCollection('dep_z')).status).toBe('PENDING');
  });

  it('surfaces API errors', async () => {
    const p = createPaystackProvider({
      secretKey: SECRET,
      fetchImpl: vi.fn(async () => json(401, { status: false, message: 'Invalid key' })),
    });
    await expect(p.verifyCollection('dep_x')).rejects.toThrow(/Invalid key/);
  });

  it('verifies webhook signatures (HMAC-SHA512 of the raw body)', () => {
    const p = createPaystackProvider({ secretKey: SECRET, fetchImpl: vi.fn() });
    const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 99, reference: 'dep_x' } }));
    const sig = createHmac('sha512', SECRET).update(raw).digest('hex');
    expect(p.parseWebhook({ rawBody: raw, headers: { 'x-paystack-signature': sig } })).toMatchObject({
      valid: true,
      eventId: 'charge.success:99',
      reference: 'dep_x',
      type: 'collection',
    });
    expect(p.parseWebhook({ rawBody: raw, headers: { 'x-paystack-signature': sig.replace(/^./, '0') } }).valid).toBe(false);
    expect(p.parseWebhook({ rawBody: Buffer.concat([raw, Buffer.from(' ')]), headers: { 'x-paystack-signature': sig } }).valid).toBe(false);
  });

  it('does not pretend to support payouts', async () => {
    const p = createPaystackProvider({ secretKey: SECRET, fetchImpl: vi.fn() });
    expect((await p.initiatePayout({})).status).toBe('FAILED');
  });
});

describe('payment configuration guards', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost/db',
    SESSION_SECRET: 'x'.repeat(40),
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  };
  it('refuses live keys in sandbox mode and the sandbox provider in live mode', () => {
    expect(() => loadEnv({ ...base, PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_live_abc' })).toThrow(/Live payment keys/);
    expect(() => loadEnv({ ...base, PAYMENT_PROVIDER: 'paystack' })).toThrow(/PAYSTACK_SECRET_KEY/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', PLATFORM_MODE: 'live', CORS_ORIGINS: 'https://app.example' })).toThrow(
      /sandbox payment provider/,
    );
    expect(loadEnv({ ...base, PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_test_abc' }).PAYMENT_PROVIDER).toBe('paystack');
  });
});
