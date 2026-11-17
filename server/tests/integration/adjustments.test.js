import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers.js';
import { createStaffClient } from '../auth-helpers.js';
import { onboardedInvestor } from '../kyc-helpers.js';

let app;
let finance;
let approver;
const idem = () => `k-${randomUUID()}`;

beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
  finance = await createStaffClient(['FINANCE_OFFICER'], app);
  approver = await createStaffClient(['SUPER_ADMIN'], app);
});
afterAll(() => prisma.$disconnect());

const request = (body, key = idem()) => finance.client.post('/api/v1/admin/ledger/adjustments').set('Idempotency-Key', key).send(body);
const approve = (id, key = idem()) =>
  approver.client
    .post(`/api/v1/admin/ledger/adjustments/${id}/approve`)
    .set('Idempotency-Key', key)
    .send({ note: 'Verified against ticket' });

describe('maker-checker wallet adjustments', () => {
  it('posts nothing until a second person approves, then credits the wallet through the ledger', async () => {
    const investor = await onboardedInvestor(app, { stopBefore: 'personal' });
    const req = await request({
      customerEmail: investor.email,
      currency: 'GHS',
      direction: 'CREDIT',
      amount: '1500.00',
      reason: 'Sandbox test funding for QA',
    }).expect(201);
    expect(req.body.data).toMatchObject({ status: 'PENDING', amount: { amountMinor: '150000' } });
    expect((await investor.client.get('/api/v1/wallet').expect(200)).body.data.wallets[0].available.amountMinor).toBe('0');

    await finance.client
      .post(`/api/v1/admin/ledger/adjustments/${req.body.data.id}/approve`)
      .set('Idempotency-Key', idem())
      .send({})
      .expect(403);
    const ok = await approve(req.body.data.id).expect(200);
    expect(ok.body.data).toMatchObject({ status: 'APPROVED' });

    const wallet = (await investor.client.get('/api/v1/wallet').expect(200)).body.data;
    expect(wallet.wallets[0]).toMatchObject({ currency: 'GHS', available: { amountMinor: '150000' }, reserved: { amountMinor: '0' } });
    expect(wallet.recentActivity[0]).toMatchObject({ type: 'ADJUSTMENT', amount: { amountMinor: '150000' } });

    const entry = (await approver.client.get(`/api/v1/admin/ledger/entries/${ok.body.data.journalEntryId}`).expect(200)).body.data;
    expect(entry.lines.map((l) => l.account.code).sort()).toEqual(['2000', '3900']);
    await approve(req.body.data.id).expect(409);
  });

  it('refuses a debit beyond the available balance and leaves the request pending', async () => {
    const investor = await onboardedInvestor(app, { stopBefore: 'personal' });
    const req = await request({
      customerEmail: investor.email,
      currency: 'GHS',
      direction: 'DEBIT',
      amount: '10.00',
      reason: 'Correcting a duplicate credit',
    }).expect(201);
    const res = await approve(req.body.data.id).expect(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect((await prisma.ledgerAdjustment.findUnique({ where: { id: req.body.data.id } })).status).toBe('PENDING');
  });

  it('supports rejection by the checker and cancellation by the maker only', async () => {
    const investor = await onboardedInvestor(app, { stopBefore: 'personal' });
    const a = (
      await request({
        customerEmail: investor.email,
        currency: 'GHS',
        direction: 'CREDIT',
        amount: '5.00',
        reason: 'Goodwill credit for test case',
      }).expect(201)
    ).body.data;
    await approver.client.post(`/api/v1/admin/ledger/adjustments/${a.id}/reject`).send({ note: 'No ticket reference' }).expect(200);
    const b = (
      await request({
        customerEmail: investor.email,
        currency: 'GHS',
        direction: 'CREDIT',
        amount: '5.00',
        reason: 'Goodwill credit for test case',
      }).expect(201)
    ).body.data;
    await approver.client.post(`/api/v1/admin/ledger/adjustments/${b.id}/cancel`).expect(403);
    await finance.client.post(`/api/v1/admin/ledger/adjustments/${b.id}/cancel`).expect(200);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: { in: [a.id, b.id] } } })).map((x) => x.action);
    expect(actions).toEqual(
      expect.arrayContaining(['ledger.adjustment_requested', 'ledger.adjustment_rejected', 'ledger.adjustment_cancelled']),
    );
  });

  it('validates the customer, amount and reason', async () => {
    await request({
      customerEmail: 'nobody@example.test',
      currency: 'GHS',
      direction: 'CREDIT',
      amount: '5.00',
      reason: 'A sufficiently long reason',
    }).expect(422);
    await request({
      customerEmail: finance.email,
      currency: 'GHS',
      direction: 'CREDIT',
      amount: '5.00',
      reason: 'A sufficiently long reason',
    }).expect(422);
    const investor = await onboardedInvestor(app, { stopBefore: 'personal' });
    await request({
      customerEmail: investor.email,
      currency: 'GHS',
      direction: 'CREDIT',
      amount: '5.001',
      reason: 'A sufficiently long reason',
    }).expect(422);
    await request({ customerEmail: investor.email, currency: 'GHS', direction: 'CREDIT', amount: '5.00', reason: 'short' }).expect(422);
    await request({
      customerEmail: investor.email,
      currency: 'NGN',
      direction: 'CREDIT',
      amount: '5.00',
      reason: 'A sufficiently long reason',
    }).expect(422);
  });
});

describe('HTTP idempotency', () => {
  it('requires a key, replays the stored response, and rejects key reuse with a different body', async () => {
    const investor = await onboardedInvestor(app, { stopBefore: 'personal' });
    const body = {
      customerEmail: investor.email,
      currency: 'GHS',
      direction: 'CREDIT',
      amount: '20.00',
      reason: 'Idempotency replay test',
    };
    const missing = await finance.client.post('/api/v1/admin/ledger/adjustments').send(body).expect(400);
    expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    await finance.client.post('/api/v1/admin/ledger/adjustments').set('Idempotency-Key', 'short').send(body).expect(400);

    const k = idem();
    const first = await request(body, k).expect(201);
    const replay = await request(body, k).expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(await prisma.ledgerAdjustment.count({ where: { customer: { email: investor.email } } })).toBe(1);

    const reused = await request({ ...body, amount: '21.00' }, k).expect(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('approves only once under concurrent retries with the same key', async () => {
    const investor = await onboardedInvestor(app, { stopBefore: 'personal' });
    const a = (
      await request({
        customerEmail: investor.email,
        currency: 'GHS',
        direction: 'CREDIT',
        amount: '30.00',
        reason: 'Concurrent approval test',
      }).expect(201)
    ).body.data;
    const k = idem();
    const results = await Promise.all(Array.from({ length: 4 }, () => approve(a.id, k)));
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
    expect(await prisma.journalEntry.count({ where: { referenceId: a.id } })).toBe(1);
    expect((await investor.client.get('/api/v1/wallet')).body.data.wallets[0].available.amountMinor).toBe('3000');
  });
});

describe('access control', () => {
  it('limits ledger tools to finance staff and wallets to their owners', async () => {
    const investor = await onboardedInvestor(app, { stopBefore: 'personal' });
    await investor.client.get('/api/v1/admin/ledger/trial-balance').expect(403);
    const support = await createStaffClient(['SUPPORT_AGENT'], app);
    await support.client.get('/api/v1/admin/ledger/entries').expect(403);
    await support.client.get(`/api/v1/admin/wallets/${investor.userId}`).expect(403);
    const auditor = await createStaffClient(['AUDITOR'], app);
    await auditor.client.get('/api/v1/admin/ledger/trial-balance').expect(200);
    await auditor.client.get(`/api/v1/admin/wallets/${investor.userId}`).expect(200);
    await auditor.client.post('/api/v1/admin/ledger/reconciliations').expect(403);
    await finance.client.post('/api/v1/admin/ledger/reconciliations').expect(201);
  });

  it('lets compliance freeze a wallet, with audit', async () => {
    const investor = await onboardedInvestor(app, { stopBefore: 'personal' });
    const officer = await createStaffClient(['COMPLIANCE_OFFICER'], app);
    await officer.client.post(`/api/v1/admin/wallets/${investor.userId}/status`).send({ currency: 'GHS', frozen: true }).expect(422);
    await officer.client
      .post(`/api/v1/admin/wallets/${investor.userId}/status`)
      .send({ currency: 'GHS', frozen: true, reason: 'Pending AML review of source of funds' })
      .expect(200);
    expect((await investor.client.get('/api/v1/wallet')).body.data.wallets[0].status).toBe('FROZEN');
    await finance.client.post(`/api/v1/admin/wallets/${investor.userId}/status`).send({ currency: 'GHS', frozen: false }).expect(403);
    expect(await prisma.auditLog.count({ where: { action: 'wallet.frozen', actorId: officer.userId } })).toBe(1);
  });

  it('reports a balanced trial balance', async () => {
    const tb = (await approver.client.get('/api/v1/admin/ledger/trial-balance?currency=GHS').expect(200)).body.data;
    expect(tb.balanced).toBe(true);
    expect(tb.lines.find((l) => l.code === '2000').name).toMatch(/customer accounts/);
  });
});
