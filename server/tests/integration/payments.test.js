import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { loadEnv } from '../../src/config/env.js';
import { createContainer } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { testLogger } from '../helpers.js';
import { createStaffClient, lastMessage } from '../auth-helpers.js';
import { onboardedInvestor } from '../kyc-helpers.js';
import { available, deposit, idem, verifiedInvestor } from '../payment-helpers.js';

let app;
let container;
let finance;

function build(envOverrides = {}) {
  const env = loadEnv({ ...process.env, ...envOverrides });
  const c = createContainer({ env, logger: testLogger, prisma });
  return { app: createApp({ env, logger: testLogger, prisma, container: c }), container: c };
}

beforeAll(async () => {
  await seed(prisma);
  ({ app, container } = build());
  finance = await createStaffClient(['FINANCE_OFFICER'], app);
});
afterAll(() => prisma.$disconnect());

const webhook = (body, signature) =>
  request(app)
    .post('/api/v1/payments/webhooks/sandbox')
    .set('Content-Type', 'application/json')
    .set('x-sandbox-signature', signature)
    .send(body);
const sign = (raw) => container.paymentProvider._sign(Buffer.from(raw));

describe('deposits', () => {
  it('requires approved identity verification and an idempotency key', async () => {
    const unverified = await onboardedInvestor(app, { stopBefore: 'personal' });
    const res = await unverified.client
      .post('/api/v1/wallet/deposits')
      .set('Idempotency-Key', idem())
      .send({ amount: '100.00' })
      .expect(403);
    expect(res.body.error.code).toBe('KYC_REQUIRED');
    const investor = await verifiedInvestor(app);
    await investor.client.post('/api/v1/wallet/deposits').send({ amount: '100.00' }).expect(400);
    await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', idem()).send({ amount: '5.00' }).expect(422);
    await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', idem()).send({ amount: '100.001' }).expect(422);
  });

  it('credits the wallet only after the provider confirms, posting a balanced entry with the provider fee', async () => {
    const investor = await verifiedInvestor(app);
    const init = await investor.client
      .post('/api/v1/wallet/deposits')
      .set('Idempotency-Key', idem())
      .send({ amount: '1000.00' })
      .expect(201);
    expect(init.body.data).toMatchObject({ status: 'PENDING', provider: 'sandbox', amount: { amountMinor: '100000' } });
    expect(init.body.data.checkoutUrl).toContain(`/sandbox/checkout/${init.body.data.reference}`);
    expect(await available(investor.client)).toBe('0');

    const done = await investor.client
      .post(`/api/v1/payments/sandbox/${init.body.data.reference}/complete`)
      .send({ outcome: 'success' })
      .expect(200);
    expect(done.body.data).toMatchObject({ status: 'SUCCEEDED', fee: { amountMinor: '1950' } });
    expect(await available(investor.client)).toBe('100000');

    const d = await prisma.deposit.findUnique({ where: { id: init.body.data.id } });
    const entry = await prisma.journalEntry.findUnique({
      where: { id: d.journalEntryId },
      include: { lines: { include: { account: true } } },
    });
    const byCode = Object.fromEntries(entry.lines.map((l) => [l.account.code, l.amountMinor]));
    expect(byCode).toEqual({ 1100: 98_050n, 5000: 1_950n, 2000: -100_000n });
    expect(await lastMessage(investor.email, 'deposit-received')).not.toBeNull();
  });

  it('marks failed checkouts as failed without touching the ledger', async () => {
    const investor = await verifiedInvestor(app);
    const d = await deposit(investor, '200.00', 'failure');
    expect(d.status).toBe('FAILED');
    expect(await available(investor.client)).toBe('0');
    expect((await prisma.deposit.findUnique({ where: { id: d.id } })).journalEntryId).toBeNull();
    expect(await lastMessage(investor.email, 'payment-failed')).not.toBeNull();
  });

  it('rejects webhooks with an invalid signature and stores nothing', async () => {
    const before = await prisma.paymentWebhookEvent.count();
    const body = JSON.stringify({ id: randomUUID(), event: 'charge.success', data: { reference: 'dep_forged' } });
    await webhook(body, 'deadbeef').expect(401);
    await request(app).post('/api/v1/payments/webhooks/sandbox').set('Content-Type', 'application/json').send(body).expect(401);
    expect(await prisma.paymentWebhookEvent.count()).toBe(before);
  });

  it('never trusts the webhook body: a correctly signed "success" is ignored while the provider still says pending', async () => {
    const investor = await verifiedInvestor(app);
    const init = await investor.client
      .post('/api/v1/wallet/deposits')
      .set('Idempotency-Key', idem())
      .send({ amount: '300.00' })
      .expect(201);
    const body = JSON.stringify({ id: randomUUID(), event: 'charge.success', data: { reference: init.body.data.reference } });
    await webhook(body, sign(body)).expect(200);
    expect(await available(investor.client)).toBe('0');
    expect((await prisma.payment.findUnique({ where: { reference: init.body.data.reference } })).status).toBe('PENDING');
  });

  it('is replay-safe: the same signed webhook processed twice credits once', async () => {
    const investor = await verifiedInvestor(app);
    const init = await investor.client
      .post('/api/v1/wallet/deposits')
      .set('Idempotency-Key', idem())
      .send({ amount: '400.00' })
      .expect(201);
    const signed = await container.paymentProvider.simulateCheckout(init.body.data.reference, 'success');
    const raw = signed.rawBody.toString('utf8');
    const first = await webhook(raw, signed.headers['x-sandbox-signature']).expect(200);
    const replay = await webhook(raw, signed.headers['x-sandbox-signature']).expect(200);
    expect([first.body.duplicate, replay.body.duplicate]).toEqual([false, true]);
    // A different event for the same payment (new id) settles idempotently too.
    const other = JSON.stringify({ id: randomUUID(), event: 'charge.success', data: { reference: init.body.data.reference } });
    await webhook(other, sign(other)).expect(200);
    expect(await available(investor.client)).toBe('40000');
    expect(await prisma.journalEntry.count({ where: { referenceId: init.body.data.id } })).toBe(1);
  });

  it('settles exactly once under concurrent settlement attempts', async () => {
    const investor = await verifiedInvestor(app);
    const init = await investor.client
      .post('/api/v1/wallet/deposits')
      .set('Idempotency-Key', idem())
      .send({ amount: '500.00' })
      .expect(201);
    await prisma.sandboxProviderTransaction.update({
      where: { reference: init.body.data.reference },
      data: { status: 'SUCCESS', feeMinor: 975n },
    });
    await Promise.all(Array.from({ length: 6 }, () => container.deposits.settleCollection(init.body.data.reference)));
    expect(await available(investor.client)).toBe('50000');
    expect(await prisma.journalEntry.count({ where: { referenceId: init.body.data.id } })).toBe(1);
  });

  it('recovers a payment whose webhook never arrived (status refresh and reconciliation job)', async () => {
    const investor = await verifiedInvestor(app);
    const a = await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', idem()).send({ amount: '120.00' }).expect(201);
    await prisma.sandboxProviderTransaction.update({ where: { reference: a.body.data.reference }, data: { status: 'SUCCESS' } });
    const refreshed = await investor.client.get(`/api/v1/wallet/deposits/${a.body.data.id}?refresh=1`).expect(200);
    expect(refreshed.body.data.status).toBe('SUCCEEDED');

    const b = await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', idem()).send({ amount: '80.00' }).expect(201);
    await prisma.sandboxProviderTransaction.update({ where: { reference: b.body.data.reference }, data: { status: 'SUCCESS' } });
    const result = await container.deposits.reconcilePending({ olderThanMs: 0 });
    expect(result.credited).toBeGreaterThanOrEqual(1);
    expect(await available(investor.client)).toBe('20000');
  });

  it('refuses to credit when the provider reports a different amount', async () => {
    const investor = await verifiedInvestor(app);
    const init = await investor.client
      .post('/api/v1/wallet/deposits')
      .set('Idempotency-Key', idem())
      .send({ amount: '250.00' })
      .expect(201);
    await prisma.sandboxProviderTransaction.update({
      where: { reference: init.body.data.reference },
      data: { status: 'SUCCESS', amountMinor: 2_500n },
    });
    expect((await container.deposits.settleCollection(init.body.data.reference)).outcome).toBe('mismatch');
    expect(await available(investor.client)).toBe('0');
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'payment.amount_mismatch',
          entityId: (await prisma.payment.findUnique({ where: { reference: init.body.data.reference } })).id,
        },
      }),
    ).toBe(1);
  });

  it("does not let an investor complete someone else's checkout", async () => {
    const a = await verifiedInvestor(app);
    const b = await verifiedInvestor(app);
    const init = await a.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', idem()).send({ amount: '100.00' }).expect(201);
    await b.client.post(`/api/v1/payments/sandbox/${init.body.data.reference}/complete`).send({ outcome: 'success' }).expect(404);
    await b.client.get(`/api/v1/wallet/deposits/${init.body.data.id}`).expect(404);
  });
});

describe('withdrawals', () => {
  const momo = (overrides = {}) => ({
    amount: '100.00',
    method: 'MOBILE_MONEY',
    destination: { network: 'MTN', accountNumber: '0241234567', accountName: 'Ama Mensah', ...overrides },
  });

  it('commits funds at request time and encrypts the destination', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '500.00');
    const res = await investor.client.post('/api/v1/wallet/withdrawals').set('Idempotency-Key', idem()).send(momo()).expect(201);
    expect(res.body.data).toMatchObject({ status: 'REQUESTED', destination: 'MTN •••• 4567 (Ama Mensah)' });
    expect(await available(investor.client)).toBe('40000');
    const row = await prisma.withdrawal.findUnique({ where: { id: res.body.data.id } });
    expect(row.destinationEncrypted).not.toContain('0241234567');
    expect(row.riskFlags).toEqual(expect.arrayContaining(['NEW_DESTINATION', 'RECENT_DEPOSIT']));
    const over = await investor.client
      .post('/api/v1/wallet/withdrawals')
      .set('Idempotency-Key', idem())
      .send({ ...momo(), amount: '400.01' })
      .expect(409);
    expect(over.body.error.code).toBe('INSUFFICIENT_FUNDS');
    await investor.client
      .post('/api/v1/wallet/withdrawals')
      .set('Idempotency-Key', idem())
      .send(momo({ accountNumber: '12345' }))
      .expect(422);
  });

  it('is approved by finance, paid out and settled in the ledger', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '500.00');
    const w = (
      await investor.client
        .post('/api/v1/wallet/withdrawals')
        .set('Idempotency-Key', idem())
        .send(momo({ accountName: 'Ama M' }))
        .expect(201)
    ).body.data;
    await investor.client.post(`/api/v1/admin/payments/withdrawals/${w.id}/approve`).set('Idempotency-Key', idem()).send({}).expect(403);
    const ok = await finance.client
      .post(`/api/v1/admin/payments/withdrawals/${w.id}/approve`)
      .set('Idempotency-Key', idem())
      .send({ note: 'Name matches KYC' })
      .expect(200);
    expect(ok.body.data).toMatchObject({ status: 'COMPLETED', reviewNote: 'Name matches KYC' });
    await investor.client.post(`/api/v1/wallet/withdrawals/${w.id}/cancel`).expect(409);
    const row = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    const entry = await prisma.journalEntry.findUnique({
      where: { id: row.settlementEntryId },
      include: { lines: { include: { account: true } } },
    });
    expect(Object.fromEntries(entry.lines.map((l) => [l.account.code, l.amountMinor]))).toEqual({ 2100: 10_000n, 1100: -10_000n });
    expect(await lastMessage(investor.email, 'withdrawal-completed')).not.toBeNull();
  });

  it('returns funds on rejection or cancellation', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '500.00');
    const a = (await investor.client.post('/api/v1/wallet/withdrawals').set('Idempotency-Key', idem()).send(momo()).expect(201)).body.data;
    await finance.client
      .post(`/api/v1/admin/payments/withdrawals/${a.id}/reject`)
      .send({ note: 'Account name does not match' })
      .expect(200);
    const b = (await investor.client.post('/api/v1/wallet/withdrawals').set('Idempotency-Key', idem()).send(momo()).expect(201)).body.data;
    await investor.client.post(`/api/v1/wallet/withdrawals/${b.id}/cancel`).expect(200);
    expect(await available(investor.client)).toBe('50000');
    expect(await lastMessage(investor.email, 'withdrawal-rejected')).not.toBeNull();
  });

  it('handles a failed payout: retry, then return to the wallet', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '500.00');
    const w = (
      await investor.client
        .post('/api/v1/wallet/withdrawals')
        .set('Idempotency-Key', idem())
        .send(momo({ accountNumber: '0240000000' }))
        .expect(201)
    ).body.data;
    const failed = await finance.client
      .post(`/api/v1/admin/payments/withdrawals/${w.id}/approve`)
      .set('Idempotency-Key', idem())
      .send({})
      .expect(200);
    expect(failed.body.data.status).toBe('FAILED');
    expect(await available(investor.client)).toBe('40000');
    const retried = await finance.client
      .post(`/api/v1/admin/payments/withdrawals/${w.id}/retry`)
      .set('Idempotency-Key', idem())
      .expect(200);
    expect(retried.body.data.status).toBe('FAILED');
    await finance.client
      .post(`/api/v1/admin/payments/withdrawals/${w.id}/return`)
      .send({ note: 'Investor to provide another account' })
      .expect(200);
    expect(await available(investor.client)).toBe('50000');
  });

  it('charges the configured withdrawal fee to fee income', async () => {
    const { app: feeApp } = build({ WITHDRAWAL_FEE_MINOR: '150' });
    const investor = await verifiedInvestor(feeApp);
    await deposit(investor, '500.00');
    const w = (await investor.client.post('/api/v1/wallet/withdrawals').set('Idempotency-Key', idem()).send(momo()).expect(201)).body.data;
    expect(w).toMatchObject({ fee: { amountMinor: '150' }, netAmount: { amountMinor: '9850' } });
    const financeFee = await createStaffClient(['FINANCE_OFFICER'], feeApp);
    await financeFee.client.post(`/api/v1/admin/payments/withdrawals/${w.id}/approve`).set('Idempotency-Key', idem()).send({}).expect(200);
    const row = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    const lines = await prisma.journalLine.findMany({ where: { entryId: row.settlementEntryId }, include: { account: true } });
    expect(Object.fromEntries(lines.map((l) => [l.account.code, l.amountMinor]))).toEqual({ 2100: 10_000n, 1100: -9_850n, 4010: -150n });
  });

  it('keeps the ledger balanced and reconciled after all payment flows', async () => {
    const run = await container.reconciliation.runLedgerIntegrity();
    expect(run.status).toBe('PASSED');
  });
});
