import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers.js';
import { createStaffClient, lastMessage } from '../auth-helpers.js';
import { available, deposit, idem, publishedProduct, verifiedInvestor } from '../payment-helpers.js';
import { createLedgerService } from '../../src/modules/ledger/ledger.service.js';
import { createReconciliationService } from '../../src/modules/ledger/reconciliation.service.js';
import { testLogger } from '../helpers.js';

let app;
let manager;
const ledger = createLedgerService({ prisma });
const reconciliation = createReconciliationService({ prisma, logger: testLogger });

beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
  manager = await createStaffClient(['OPERATIONS_MANAGER'], app);
});
afterAll(() => prisma.$disconnect());

const order = (investor, body) =>
  investor.client
    .post('/api/v1/investments/orders')
    .set('Idempotency-Key', idem())
    .send({ acceptRiskDisclosure: true, ...body });
const confirm = (id, ref = 'CSD-TEST-0001') =>
  manager.client.post(`/api/v1/admin/orders/${id}/confirm`).set('Idempotency-Key', idem()).send({ custodianReference: ref });

async function fundedInvestor(amount = '5000.00') {
  const investor = await verifiedInvestor(app);
  await deposit(investor, amount);
  return investor;
}

describe('placing orders', () => {
  it('reserves funds, records the product version, and notifies the investor', async () => {
    const product = await publishedProduct(app);
    const investor = await fundedInvestor();
    const res = await order(investor, { productSlug: product.slug, amount: '1000.00' }).expect(201);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      productVersion: 1,
      amount: { amountMinor: '100000' },
      fee: { amountMinor: '1000' },
      invested: { amountMinor: '99000' },
    });
    const wallet = (await investor.client.get('/api/v1/wallet').expect(200)).body.data.wallets[0];
    expect([wallet.available.amountMinor, wallet.reserved.amountMinor]).toEqual(['400000', '100000']);
    expect(await lastMessage(investor.email, 'investment-submitted')).not.toBeNull();
  });

  it('enforces verification, risk questionnaire, disclosure, minimum, increment and balance', async () => {
    const product = await publishedProduct(app, { incrementMinor: undefined, increment: '50.00' });
    const investor = await fundedInvestor('500.00');
    await investor.client
      .post('/api/v1/investments/orders')
      .set('Idempotency-Key', idem())
      .send({ productSlug: product.slug, amount: '100.00' })
      .expect(422);
    expect((await order(investor, { productSlug: product.slug, amount: '50.00' }).expect(422)).body.error.code).toBe('BELOW_MINIMUM');
    expect((await order(investor, { productSlug: product.slug, amount: '120.00' }).expect(422)).body.error.code).toBe('INVALID_INCREMENT');
    expect((await order(investor, { productSlug: product.slug, amount: '600.00' }).expect(409)).body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await prisma.investmentOrder.count({ where: { userId: investor.userId } })).toBe(0);

    await prisma.investorProfile.update({
      where: { userId: investor.userId },
      data: { kycStatus: 'UNDER_REVIEW', kycVerifiedAt: null, riskRating: null },
    });
    expect((await order(investor, { productSlug: product.slug, amount: '100.00' }).expect(403)).body.error.code).toBe('KYC_REQUIRED');
  });

  it('requires explicit acknowledgement when the product exceeds the investor’s risk profile', async () => {
    const product = await publishedProduct(app, { minRiskProfile: 'AGGRESSIVE', riskLevel: 6 });
    const investor = await fundedInvestor();
    const res = await order(investor, { productSlug: product.slug, amount: '100.00' }).expect(409);
    expect(res.body.error.code).toBe('UNSUITABLE_ACK_REQUIRED');
    const ok = await order(investor, { productSlug: product.slug, amount: '100.00', acknowledgeUnsuitable: true }).expect(201);
    expect(ok.body.data.unsuitableAcknowledged).toBe(true);
  });

  it('enforces the per-investor maximum and total capacity, also under concurrency', async () => {
    const product = await publishedProduct(app, { maxInvestment: '300.00', capacity: '500.00' });
    const a = await fundedInvestor();
    await order(a, { productSlug: product.slug, amount: '200.00' }).expect(201);
    expect((await order(a, { productSlug: product.slug, amount: '150.00' }).expect(422)).body.error.code).toBe('ABOVE_MAXIMUM');

    const others = await Promise.all([fundedInvestor(), fundedInvestor(), fundedInvestor()]);
    const results = await Promise.all(others.map((inv) => order(inv, { productSlug: product.slug, amount: '200.00' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1); // 200 + 200 = 400 ≤ 500; a third would exceed
    expect(results.filter((r) => r.status === 409 && r.body.error.code === 'CAPACITY_EXCEEDED')).toHaveLength(2);
  });

  it('refuses orders for products that are not open', async () => {
    const product = await publishedProduct(app, { subscriptionOpensAt: new Date(Date.now() + 86_400_000).toISOString() });
    const investor = await fundedInvestor();
    expect((await order(investor, { productSlug: product.slug, amount: '100.00' }).expect(409)).body.error.code).toBe('NOT_OPEN');
  });
});

describe('processing orders', () => {
  it('confirms with an allocation reference: reserved → holdings + fee income, holding opened', async () => {
    const product = await publishedProduct(app);
    const investor = await fundedInvestor();
    const placed = (await order(investor, { productSlug: product.slug, amount: '1000.00' }).expect(201)).body.data;
    await manager.client
      .post(`/api/v1/admin/orders/${placed.id}/confirm`)
      .set('Idempotency-Key', idem())
      .send({ custodianReference: 'x' })
      .expect(422);
    const res = await confirm(placed.id).expect(200);
    expect(res.body.data).toMatchObject({ status: 'ACTIVE', allocation: { custodianReference: 'CSD-TEST-0001' } });
    expect(res.body.data.holding).toMatchObject({ status: 'ACTIVE', principal: { amountMinor: '99000' } });
    expect(res.body.data.holding.maturityDate).not.toBeNull();

    const o = await prisma.investmentOrder.findUnique({ where: { id: placed.id } });
    const lines = await prisma.journalLine.findMany({ where: { entryId: o.confirmEntryId }, include: { account: true } });
    expect(Object.fromEntries(lines.map((l) => [l.account.code, l.amountMinor]))).toEqual({
      2010: 100_000n,
      2300: -99_000n,
      4010: -1_000n,
    });
    const wallet = (await investor.client.get('/api/v1/wallet').expect(200)).body.data.wallets[0];
    expect(wallet.reserved.amountMinor).toBe('0');
    await confirm(placed.id).expect(409);
    const alloc = await prisma.investmentAllocation.findUnique({ where: { orderId: placed.id } });
    await expect(prisma.investmentAllocation.update({ where: { id: alloc.id }, data: { custodianReference: 'edited' } })).rejects.toThrow(
      /append-only/,
    );
    expect(await lastMessage(investor.email, 'investment-confirmed')).not.toBeNull();

    const portfolio = (await investor.client.get('/api/v1/investments/portfolio').expect(200)).body.data;
    expect(portfolio.investedPrincipal).toEqual([{ amountMinor: '99000', currency: 'GHS' }]);
  });

  it('releases reserved funds when the investor cancels or staff reject', async () => {
    const product = await publishedProduct(app);
    const investor = await fundedInvestor('1000.00');
    const a = (await order(investor, { productSlug: product.slug, amount: '300.00' }).expect(201)).body.data;
    const b = (await order(investor, { productSlug: product.slug, amount: '200.00' }).expect(201)).body.data;
    await investor.client.post(`/api/v1/investments/orders/${a.id}/cancel`).expect(200);
    await manager.client.post(`/api/v1/admin/orders/${b.id}/reject`).send({ note: 'Issuer allocation closed early' }).expect(200);
    expect(await available(investor.client)).toBe('100000');
    await investor.client.post(`/api/v1/investments/orders/${b.id}/cancel`).expect(409);
    expect(await lastMessage(investor.email, 'investment-rejected')).not.toBeNull();
  });

  it('settles maturity with the custodian’s actual proceeds, net of management fee', async () => {
    const product = await publishedProduct(app, { termDays: 91, managementFeePercent: '2' });
    const investor = await fundedInvestor();
    const placed = (await order(investor, { productSlug: product.slug, amount: '1000.00' }).expect(201)).body.data;
    const holdingId = (await confirm(placed.id).expect(200)).body.data.holding.id;

    // Move the holding back in time so it is due (91 days ago → today).
    const start = new Date(Date.now() - 91 * 86_400_000);
    await prisma.investmentHolding.update({
      where: { id: holdingId },
      data: { startDate: new Date(start.toISOString().slice(0, 10)), maturityDate: new Date(new Date().toISOString().slice(0, 10)) },
    });
    await manager.client
      .post(`/api/v1/admin/holdings/${holdingId}/settle`)
      .set('Idempotency-Key', idem())
      .send({ proceeds: '1040.00', custodianReference: 'CSD-MAT-1' })
      .expect(409);

    const flagged = await (
      await import('../../src/container.js')
    )
      .createContainer({ env: (await import('../../src/config/env.js')).loadEnv(process.env), logger: testLogger, prisma })
      .orders.flagMaturities();
    expect(flagged.flagged).toBeGreaterThanOrEqual(1);
    const due = (await manager.client.get('/api/v1/admin/holdings/due').expect(200)).body.data;
    expect(due.map((h) => h.id)).toContain(holdingId);

    const before = BigInt(await available(investor.client));
    const settled = await manager.client
      .post(`/api/v1/admin/holdings/${holdingId}/settle`)
      .set('Idempotency-Key', idem())
      .send({ proceeds: '1040.00', custodianReference: 'CSD-MAT-1' })
      .expect(200);
    // Management fee: 990.00 × 2% × 91/365 = 4.936… → rounded up to 4.94
    expect(settled.body.data).toMatchObject({
      status: 'MATURED',
      proceeds: { amountMinor: '104000' },
      managementFee: { amountMinor: '494' },
    });
    expect(BigInt(await available(investor.client)) - before).toBe(104_000n - 494n);
    expect((await prisma.investmentOrder.findUnique({ where: { id: placed.id } })).status).toBe('MATURED');
    expect(await lastMessage(investor.email, 'investment-matured')).not.toBeNull();
  });

  it('limits order administration to authorised staff', async () => {
    const product = await publishedProduct(app);
    const investor = await fundedInvestor();
    const placed = (await order(investor, { productSlug: product.slug, amount: '100.00' }).expect(201)).body.data;
    await investor.client
      .post(`/api/v1/admin/orders/${placed.id}/confirm`)
      .set('Idempotency-Key', idem())
      .send({ custodianReference: 'CSD-1' })
      .expect(403);
    const finance = await createStaffClient(['FINANCE_OFFICER'], app);
    await finance.client
      .post(`/api/v1/admin/orders/${placed.id}/confirm`)
      .set('Idempotency-Key', idem())
      .send({ custodianReference: 'CSD-1' })
      .expect(403);
    const auditor = await createStaffClient(['AUDITOR'], app);
    await auditor.client.get(`/api/v1/admin/orders/${placed.id}`).expect(200);
    const other = await verifiedInvestor(app);
    await other.client.get(`/api/v1/investments/orders/${placed.id}`).expect(404);
  });

  it('leaves every currency balanced and reconciled', async () => {
    expect((await ledger.trialBalance('GHS')).balanced).toBe(true);
    expect((await reconciliation.runLedgerIntegrity()).status).toBe('PASSED');
  });
});
