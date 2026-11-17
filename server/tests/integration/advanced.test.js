import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp, testLogger } from '../helpers.js';
import { createStaffClient, login } from '../auth-helpers.js';
import { available, deposit, idem, publishedProduct, verifiedInvestor } from '../payment-helpers.js';
import { createReconciliationService } from '../../src/modules/ledger/reconciliation.service.js';

let app;
let finance; // fx:manage, tax:rules:manage (maker)
let ops; // approvals:decide (checker)
let manager; // investments:orders:manage
let compliance;
const reconciliation = createReconciliationService({ prisma, logger: testLogger });
const RUN = Date.now().toString(36);

beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
  finance = await createStaffClient(['FINANCE_OFFICER'], app);
  ops = await createStaffClient(['OPERATIONS_MANAGER'], app);
  manager = await createStaffClient(['OPERATIONS_MANAGER'], app);
  compliance = await createStaffClient(['COMPLIANCE_OFFICER'], app);
});
afterAll(async () => {
  // Leave the shared test database as other files expect it: only GHS active.
  await prisma.currency.update({ where: { code: 'USD' }, data: { isActive: false } });
  await prisma.$disconnect();
});

const approve = (id) => ops.client.post(`/api/v1/admin/approvals/${id}/decide`).send({ approve: true, note: 'Checked' }).expect(200);
const usdBalance = async (client) =>
  (await client.get('/api/v1/wallet').expect(200)).body.data.wallets.find((w) => w.currency === 'USD')?.available.amountMinor ?? '0';

describe('multi-currency conversion', () => {
  it('activates a currency only with a second approver', async () => {
    await prisma.currency.update({ where: { code: 'USD' }, data: { isActive: false } });
    const req = await finance.client
      .post('/api/v1/admin/fx/currencies/USD/proposals')
      .send({ active: true, reason: 'Offer USD wallets for diaspora investors' })
      .expect(202);
    expect((await prisma.currency.findUnique({ where: { code: 'USD' } })).isActive).toBe(false);
    await finance.client.post(`/api/v1/admin/approvals/${req.body.data.id}/decide`).send({ approve: true, note: 'self' }).expect(403);
    await approve(req.body.data.id);
    expect((await prisma.currency.findUnique({ where: { code: 'USD' } })).isActive).toBe(true);
    await finance.client
      .post('/api/v1/admin/fx/currencies/GHS/proposals')
      .send({ active: false, reason: 'Trying to switch off the anchor' })
      .expect(409);
  });

  it('quotes exactly, converts once through FX clearing, and keeps each currency balanced', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '1000.00');
    const before = BigInt(await available(investor.client));
    const q = (await investor.client.post('/api/v1/fx/quotes').send({ from: 'GHS', to: 'USD', amount: '155.00' }).expect(201)).body.data;
    // Fee: 15500 × 1.5% = 232.5 → 233 (up). Converted: (15500 − 233) / 15.5 = 984.96… → 984 (down).
    expect(q).toMatchObject({
      fee: { amountMinor: '233' },
      to: { amountMinor: '984', currency: 'USD' },
      rateSource: 'sandbox',
      spreadBps: 150,
    });
    expect(q.rate).toBe('0.0645161290');

    const c = (await investor.client.post('/api/v1/fx/conversions').send({ quoteId: q.id }).expect(201)).body.data;
    expect(c.to.amountMinor).toBe('984');
    expect(BigInt(await available(investor.client))).toBe(before - 15500n);
    expect(await usdBalance(investor.client)).toBe('984');
    const again = await investor.client.post('/api/v1/fx/conversions').send({ quoteId: q.id }).expect(409);
    expect(again.body.error.code).toBe('QUOTE_USED');

    const entry = await prisma.journalEntry.findFirst({ where: { referenceId: c.id }, include: { lines: true } });
    for (const cur of ['GHS', 'USD']) {
      expect(entry.lines.filter((l) => l.currency === cur).reduce((a, l) => a + l.amountMinor, 0n)).toBe(0n);
    }
    const positions = (await finance.client.get('/api/v1/admin/fx/positions').expect(200)).body.data;
    expect(positions.every((p) => p.reconciled)).toBe(true);
    expect((await reconciliation.runLedgerIntegrity()).status).toBe('PASSED');
  });

  it('rejects expired, foreign and unaffordable quotes', async () => {
    const investor = await verifiedInvestor(app);
    const other = await verifiedInvestor(app);
    await deposit(investor, '100.00');
    const q = (await investor.client.post('/api/v1/fx/quotes').send({ from: 'GHS', to: 'USD', amount: '50.00' }).expect(201)).body.data;
    await other.client.post('/api/v1/fx/conversions').send({ quoteId: q.id }).expect(404);
    await prisma.fxQuote.update({ where: { id: q.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await investor.client.post('/api/v1/fx/conversions').send({ quoteId: q.id }).expect(409)).body.error.code).toBe(
      'QUOTE_EXPIRED',
    );
    const big = (await investor.client.post('/api/v1/fx/quotes').send({ from: 'GHS', to: 'USD', amount: '5000.00' }).expect(201)).body.data;
    expect((await investor.client.post('/api/v1/fx/conversions').send({ quoteId: big.id }).expect(409)).body.error.code).toBe(
      'INSUFFICIENT_FUNDS',
    );
    await investor.client.post('/api/v1/fx/quotes').send({ from: 'GHS', to: 'GHS', amount: '5.00' }).expect(422);
  });

  it('refuses to deactivate a currency while customers hold it', async () => {
    const req = await finance.client
      .post('/api/v1/admin/fx/currencies/USD/proposals')
      .send({ active: false, reason: 'Testing the held-balance guard' })
      .expect(202);
    const d = (await approve(req.body.data.id)).body.data;
    expect(d.status).toBe('FAILED');
    expect(d.error).toMatch(/customers hold balances/);
  });
});

describe('subscription renewal (rollover at maturity)', () => {
  async function heldInvestment() {
    const product = await publishedProduct(app, { termDays: 91, managementFeePercent: '0', entryFeePercent: '0' });
    const investor = await verifiedInvestor(app);
    await deposit(investor, '2000.00');
    const placed = (
      await investor.client
        .post('/api/v1/investments/orders')
        .set('Idempotency-Key', idem())
        .send({ productSlug: product.slug, amount: '1000.00', acceptRiskDisclosure: true })
        .expect(201)
    ).body.data;
    const holding = (
      await manager.client
        .post(`/api/v1/admin/orders/${placed.id}/confirm`)
        .set('Idempotency-Key', idem())
        .send({ custodianReference: 'CSD-ROLL-1' })
        .expect(200)
    ).body.data.holding;
    return { investor, holdingId: holding.id };
  }
  const settle = async (holdingId) => {
    await prisma.investmentHolding.update({ where: { id: holdingId }, data: { status: 'MATURITY_DUE' } });
    return manager.client
      .post(`/api/v1/admin/holdings/${holdingId}/settle`)
      .set('Idempotency-Key', idem())
      .send({ proceeds: '1049.86', custodianReference: 'CSD-ROLL-M' })
      .expect(200);
  };

  it('reinvests the proceeds into the same product when the investor asked', async () => {
    const { investor, holdingId } = await heldInvestment();
    await investor.client.post(`/api/v1/investments/holdings/${holdingId}/rollover`).send({ enabled: true }).expect(422);
    const on = await investor.client
      .post(`/api/v1/investments/holdings/${holdingId}/rollover`)
      .send({ enabled: true, acceptRiskDisclosure: true })
      .expect(200);
    expect(on.body.data.rollover).toBe(true);
    await settle(holdingId);
    const h = await prisma.investmentHolding.findUnique({ where: { id: holdingId } });
    expect(h.rolloverOrderId).toBeTruthy();
    const order = await prisma.investmentOrder.findUnique({ where: { id: h.rolloverOrderId } });
    expect(order).toMatchObject({ status: 'PENDING', amountMinor: 104986n });
    expect(h.rolloverNote).toMatch(/^Reinvested in order #/);
  });

  it('does not reinvest if the product terms changed after consent', async () => {
    const { investor, holdingId } = await heldInvestment();
    await investor.client
      .post(`/api/v1/investments/holdings/${holdingId}/rollover`)
      .send({ enabled: true, acceptRiskDisclosure: true })
      .expect(200);
    await prisma.investmentHolding.update({ where: { id: holdingId }, data: { rolloverVersion: 0 } });
    const before = BigInt(await available(investor.client));
    await settle(holdingId);
    const h = await prisma.investmentHolding.findUnique({ where: { id: holdingId } });
    expect(h.rolloverOrderId).toBeNull();
    expect(h.rolloverNote).toMatch(/terms changed/);
    expect(BigInt(await available(investor.client))).toBe(before + 104986n);
  });
});

describe('tax rules and statements', () => {
  it('applies only approved rules and states estimates without withholding', async () => {
    const investor = await verifiedInvestor(app);
    const year = new Date().getUTCFullYear();
    const none = (await investor.client.post('/api/v1/statements').send({ kind: 'TAX_STATEMENT', year, format: 'CSV' }).expect(201)).body
      .data;
    expect(none.title).toMatch(/Tax statement \d{4}/);

    const req = await finance.client
      .post('/api/v1/admin/tax/rules')
      .send({
        jurisdiction: 'XT',
        incomeType: 'REFERRAL_REWARD',
        ratePercent: '7.5',
        effectiveFrom: `${year}-01-01`,
        description: `Test-only rule ${RUN}`,
        legalReference: 'Test fixture, not a real tax rule',
        reason: 'Exercise the tax rule approval flow',
      })
      .expect(202);
    expect(
      (await finance.client.get('/api/v1/admin/tax/rules').expect(200)).body.data.some((r) => r.description === `Test-only rule ${RUN}`),
    ).toBe(false);
    await approve(req.body.data.id);
    const rule = (await finance.client.get('/api/v1/admin/tax/rules').expect(200)).body.data.find(
      (r) => r.description === `Test-only rule ${RUN}`,
    );
    expect(rule).toMatchObject({ ratePercent: '7.5', active: true });

    const { createTaxService } = await import('../../src/modules/tax/tax.service.js');
    const { createApprovalsService } = await import('../../src/modules/approvals/approvals.service.js');
    const tax = createTaxService({ prisma, approvals: createApprovalsService({ prisma, audit: { record: async () => null } }) });
    await prisma.userProfile.update({ where: { userId: investor.userId }, data: { country: 'XT' } });
    // A referral reward paid this year (records created directly; the payout flow has its own tests).
    const friend = await verifiedInvestor(app);
    const referral = await prisma.referral.create({
      data: { referrerId: investor.userId, referredUserId: friend.userId, status: 'REWARDED' },
    });
    const campaign = await prisma.referralCampaign.create({
      data: {
        name: `Tax test ${RUN}`,
        currency: 'GHS',
        rewardMinor: 1000n,
        minInvestmentMinor: 0n,
        startsAt: new Date(),
        createdById: finance.userId,
      },
    });
    await prisma.referralReward.create({
      data: {
        referralId: referral.id,
        referrerId: investor.userId,
        campaignId: campaign.id,
        amountMinor: 1000n,
        currency: 'GHS',
        journalEntryId: randomUUID(),
      },
    });
    const summary = await tax.yearSummary(investor.userId, year);
    expect(summary).toMatchObject({ jurisdiction: 'XT', rulesConfigured: true });
    const item = summary.items.find((i) => i.incomeType === 'REFERRAL_REWARD');
    expect(item).toMatchObject({ incomeMinor: '1000', estimatedTaxMinor: '75' }); // 1000 × 7.5% = 75
    expect(summary.totals.GHS).toEqual({ incomeMinor: '1000', estimatedTaxMinor: '75' });

    const off = await finance.client
      .post(`/api/v1/admin/tax/rules/${rule.id}/deactivate`)
      .send({ reason: 'Clean up the test rule' })
      .expect(202);
    await approve(off.body.data.id);
    expect((await prisma.taxRule.findUnique({ where: { id: rule.id } })).active).toBe(false);
  });
});

describe('fraud monitoring and risk scoring', () => {
  it('raises a suspicious-login alert for a new device after repeated failures and scores the user', async () => {
    const investor = await verifiedInvestor(app);
    const fresh = await (await import('../auth-helpers.js')).createClient(app);
    for (let i = 0; i < 3; i++) await login(fresh, investor.email, 'wrong password attempt').expect(401);
    await fresh.agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', fresh.csrf)
      .set('User-Agent', 'NewDevice/1.0')
      .send({ email: investor.email, password: 'correct horse battery staple' })
      .expect(200);
    const alert = await prisma.monitoringAlert.findFirst({ where: { userId: investor.userId, rule: 'SUSPICIOUS_LOGIN' } });
    expect(alert).toMatchObject({ severity: 'HIGH' });

    const score = (await compliance.client.get(`/api/v1/admin/insights/risk-scores/${investor.userId}`).expect(200)).body.data;
    expect(score.score).toBeGreaterThanOrEqual(20);
    expect(score.factors.map((f) => f.reason).join(' ')).toMatch(/monitoring alert/);
    const top = (await compliance.client.get('/api/v1/admin/insights/risk-scores').expect(200)).body.data;
    expect(top.length).toBeGreaterThan(0);
    expect(top.every((t, i) => i === 0 || top[i - 1].score >= t.score)).toBe(true); // highest first
    expect(top[0]).toHaveProperty('factors');
    const agent = await createStaffClient(['SUPPORT_AGENT'], app);
    await agent.client.get(`/api/v1/admin/insights/risk-scores/${investor.userId}`).expect(403);
  });
});

describe('risk management, fees and BI', () => {
  it('reports concentration, portfolio risk metrics, the fee schedule and KPIs', async () => {
    const conc = (await ops.client.get('/api/v1/admin/insights/concentration').expect(200)).body.data;
    expect(BigInt(conc.totalMinor)).toBeGreaterThan(0n);
    expect(conc.byProduct.reduce((a, g) => a + g.shareBps, 0)).toBeLessThanOrEqual(10_000);
    expect(conc.byIssuer[0]).toHaveProperty('flagged');

    const investor = await verifiedInvestor(app);
    await deposit(investor, '1000.00');
    const product = await publishedProduct(app, { riskLevel: 6, minRiskProfile: 'CONSERVATIVE' });
    const placed = (
      await investor.client
        .post('/api/v1/investments/orders')
        .set('Idempotency-Key', idem())
        .send({ productSlug: product.slug, amount: '500.00', acceptRiskDisclosure: true })
        .expect(201)
    ).body.data;
    await manager.client
      .post(`/api/v1/admin/orders/${placed.id}/confirm`)
      .set('Idempotency-Key', idem())
      .send({ custodianReference: 'CSD-RISK-1' })
      .expect(200);
    const today = new Date().toISOString().slice(0, 10);
    const a = (await investor.client.get(`/api/v1/portfolio/analytics?from=${today}&to=${today}`).expect(200)).body.data;
    expect(a.riskMetrics).toMatchObject({
      holdings: 1,
      weightedRiskLevel: '6.0',
      highRiskShareBps: 10_000,
      largestHoldingShareBps: 10_000,
    });

    const fees = (await ops.client.get('/api/v1/admin/insights/fees').expect(200)).body.data;
    expect(fees.platform.map((f) => f.fee)).toEqual(['Deposit', 'Withdrawal', 'Currency conversion']);
    expect(fees.products.find((p) => p.slug === product.slug)).toMatchObject({ entryFeePercent: '1', managementFeePercent: '2' });

    const k = (await ops.client.get('/api/v1/admin/insights/kpis?months=3').expect(200)).body.data;
    expect(k.funnel.map((f) => f.stage)).toEqual(['Registered', 'Identity verified', 'Made a deposit', 'Invested']);
    expect(k.funnel[0].count).toBeGreaterThanOrEqual(k.funnel[3].count);
    expect(k.monthly).toHaveLength(3);
    expect(BigInt(k.monthly.at(-1).depositsMinor)).toBeGreaterThan(0n);
  });
});
