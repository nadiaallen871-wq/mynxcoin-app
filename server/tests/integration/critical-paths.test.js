import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp, testLogger } from '../helpers.js';
import { available, deposit, idem, verifiedInvestor } from '../payment-helpers.js';
import { createReconciliationService } from '../../src/modules/ledger/reconciliation.service.js';

/**
 * Concurrency and replay checks on the money paths: duplicate submissions racing each
 * other must settle exactly once, balances must never go negative, and every run must
 * leave the ledger reconciled.
 */
let app;
const reconciliation = createReconciliationService({ prisma, logger: testLogger });

beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
  await prisma.currency.update({ where: { code: 'USD' }, data: { isActive: true } });
});
afterAll(async () => {
  await prisma.currency.update({ where: { code: 'USD' }, data: { isActive: false } });
  await prisma.$disconnect();
});

const withdraw = (investor, amount, key = idem()) =>
  investor.client
    .post('/api/v1/wallet/withdrawals')
    .set('Idempotency-Key', key)
    .send({ amount, method: 'MOBILE_MONEY', destination: { network: 'MTN', accountNumber: '0241234567', accountName: 'Ama Mensah' } });

describe('racing duplicate submissions', () => {
  it('converts one FX quote exactly once when it is submitted five times at the same moment', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '500.00');
    const before = BigInt(await available(investor.client));
    const q = (await investor.client.post('/api/v1/fx/quotes').send({ from: 'GHS', to: 'USD', amount: '155.00' }).expect(201)).body.data;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => investor.client.post('/api/v1/fx/conversions').send({ quoteId: q.id })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'QUOTE_USED')).toBe(true);
    expect(BigInt(await available(investor.client))).toBe(before - 15500n);
    expect(await prisma.currencyConversion.count({ where: { quoteId: q.id } })).toBe(1);
  });

  it('never lets withdrawals racing each other overdraw the wallet', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '100.00');
    const results = await Promise.all(Array.from({ length: 5 }, () => withdraw(investor, '30.00')));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(3); // 3 × 30 fits in 100; the 4th and 5th would overdraw
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'INSUFFICIENT_FUNDS')).toBe(true);
    expect(BigInt(await available(investor.client))).toBe(1000n);
  });

  it('returns the original response when the same idempotency key is sent twice at once', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '100.00');
    const key = idem();
    const [a, b] = await Promise.all([withdraw(investor, '40.00', key), withdraw(investor, '40.00', key)]);
    const statuses = [a.status, b.status].sort();
    // Either both see the stored response, or one is told the request is still in flight. Never two withdrawals.
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    expect(await prisma.withdrawal.count({ where: { userId: investor.userId } })).toBe(1);
  });
});

describe('idempotency keys', () => {
  it('treats an expired key as new instead of replaying a stale response', async () => {
    const investor = await verifiedInvestor(app);
    const key = idem();
    const first = await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', key).send({ amount: '20.00' }).expect(201);
    const replay = await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', key).send({ amount: '20.00' }).expect(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(replay.headers['idempotency-replayed']).toBe('true');

    await prisma.idempotencyKey.updateMany({ where: { key }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const fresh = await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', key).send({ amount: '20.00' }).expect(201);
    expect(fresh.body.data.id).not.toBe(first.body.data.id);
  });

  it('rejects a key reused for a different request', async () => {
    const investor = await verifiedInvestor(app);
    const key = idem();
    await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', key).send({ amount: '20.00' }).expect(201);
    const res = await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', key).send({ amount: '25.00' }).expect(422);
    expect(res.body.error.code).toMatch(/IDEMPOTENCY/);
  });
});

describe('payment recovery job', () => {
  it('counts payments still pending at the provider without crediting them', async () => {
    const investor = await verifiedInvestor(app);
    const init = await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', idem()).send({ amount: '30.00' }).expect(201);
    await prisma.payment.updateMany({
      where: { reference: init.body.data.reference },
      data: { createdAt: new Date(Date.now() - 600_000) },
    });
    const { createContainer } = await import('../../src/container.js');
    const { loadEnv } = await import('../../src/config/env.js');
    const container = createContainer({ env: loadEnv(process.env), logger: testLogger, prisma });
    const before = BigInt(await available(investor.client));
    const r = await container.deposits.reconcilePending({ olderThanMs: 60_000, limit: 500 });
    expect(r.checked).toBeGreaterThanOrEqual(1);
    expect(r.pending).toBeGreaterThanOrEqual(1);
    expect(BigInt(await available(investor.client))).toBe(before);
  });
});

it('leaves the ledger reconciled after all of the above', async () => {
  expect((await reconciliation.runLedgerIntegrity()).status).toBe('PASSED');
});
