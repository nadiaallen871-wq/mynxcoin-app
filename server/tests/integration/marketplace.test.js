import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers.js';
import { createClient, createStaffClient } from '../auth-helpers.js';
import { PDF, PNG, onboardedInvestor } from '../kyc-helpers.js';

let app;
let maker;
let checker;
let admin;
const LONG =
  'This product invests in short-dated Government of Ghana treasury bills held to maturity on behalf of investors through a licensed custodian. '.repeat(
    2,
  );
const RISKS =
  'You could lose money if the issuer defaults. Inflation may exceed the return. You cannot withdraw before maturity without paying the early exit fee. '.repeat(
    2,
  );

const productPayload = (overrides = {}) => ({
  slug: `t-bill-${randomUUID().slice(0, 8)}`,
  name: '91-Day Treasury Bill',
  shortDescription: 'Short-term Government of Ghana bill held to maturity.',
  description: LONG,
  categorySlug: 'government-securities',
  productType: 'TREASURY_BILL',
  issuerName: 'Bank of Ghana (on behalf of the Government of Ghana)',
  currency: 'GHS',
  minInvestment: '100.00',
  maxInvestment: '500000.00',
  returnType: 'FIXED',
  annualRatePercent: '24.5',
  termDays: 91,
  redemptionTerms: 'Repaid with interest at maturity. Early exit subject to secondary-market availability.',
  entryFeePercent: '0.5',
  managementFeePercent: '0',
  earlyExitFeePercent: '1',
  riskLevel: 2,
  minRiskProfile: 'CONSERVATIVE',
  riskDisclosure: RISKS,
  eligibleInvestorTypes: ['INDIVIDUAL', 'INSTITUTIONAL'],
  ...overrides,
});

async function draft(overrides) {
  const res = await maker.client.post('/api/v1/admin/products').send(productPayload(overrides)).expect(201);
  return res.body.data;
}

function attachKid(id, client = maker.client) {
  return client
    .post(`/api/v1/admin/products/${id}/documents`)
    .field('kind', 'KEY_INFORMATION')
    .field('title', 'Key information document')
    .attach('file', PDF, 'kid.pdf');
}

async function published(overrides) {
  const p = await draft(overrides);
  await attachKid(p.id).expect(201);
  const res = await checker.client.post(`/api/v1/admin/products/${p.id}/publish`).expect(200);
  return res.body.data;
}

beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
  maker = await createStaffClient(['INVESTMENT_MANAGER'], app);
  checker = await createStaffClient(['INVESTMENT_MANAGER'], app);
  admin = await createStaffClient(['ADMIN'], app);
});
afterAll(() => prisma.$disconnect());

describe('product administration', () => {
  it('creates drafts with exact money and rate conversion, hidden from the public', async () => {
    const p = await draft();
    expect(p).toMatchObject({
      status: 'DRAFT',
      version: 0,
      annualRatePercent: '24.5',
      fees: { entryPercent: '0.5', earlyExitPercent: '1' },
    });
    expect(p.minInvestment).toMatchObject({ amountMinor: '10000', currency: 'GHS', decimal: '100.00' });
    const row = await prisma.investmentProduct.findUnique({ where: { id: p.id } });
    expect(row.annualRate.toString()).toBe('0.245');
    const anon = await createClient(app);
    await anon.get(`/api/v1/investments/${p.slug}`).expect(404);
  });

  it('validates cross-field rules', async () => {
    const bad = (o) => maker.client.post('/api/v1/admin/products').send(productPayload(o));
    expect((await bad({ maxInvestment: '50.00' }).expect(422)).body.error.details[0].path).toBe('maxInvestment');
    expect((await bad({ returnType: 'NONE' }).expect(422)).body.error.details[0].path).toBe('annualRatePercent');
    expect((await bad({ annualRatePercent: null }).expect(422)).body.error.details[0].path).toBe('annualRatePercent');
    await bad({ minInvestment: '100.001' }).expect(422);
    await bad({ entryFeePercent: '25' }).expect(422);
    await bad({ eligibleInvestorTypes: ['STAFF'] }).expect(422);
    await bad({ subscriptionOpensAt: '2027-02-01T00:00:00Z', subscriptionClosesAt: '2027-01-01T00:00:00Z' }).expect(422);
    await bad({ categorySlug: 'no-such-category' }).expect(422);
    const p = await draft();
    await maker.client
      .post('/api/v1/admin/products')
      .send(productPayload({ slug: p.slug }))
      .expect(409);
  });

  it('refuses to publish incomplete products and lists what is missing', async () => {
    const p = await draft({ description: 'Too short', riskDisclosure: 'Too short as well', termDays: null });
    const res = await checker.client.post(`/api/v1/admin/products/${p.id}/publish`).expect(422);
    expect(res.body.error.details.map((d) => d.path).sort()).toEqual(['description', 'documents', 'riskDisclosure', 'termDays']);
  });

  it('enforces the four-eyes rule on publishing', async () => {
    const p = await draft();
    await attachKid(p.id).expect(201);
    const self = await maker.client.post(`/api/v1/admin/products/${p.id}/publish`).expect(403);
    expect(self.body.error.message).toMatch(/Four-eyes/);
    const ok = await checker.client.post(`/api/v1/admin/products/${p.id}/publish`).expect(200);
    expect(ok.body.data).toMatchObject({ status: 'PUBLISHED', version: 1 });
    expect(ok.body.data.versions[0]).toMatchObject({ version: 1 });
  });

  it('locks published terms; edits require suspend, then republish creates a new version', async () => {
    const p = await published();
    const locked = await maker.client.patch(`/api/v1/admin/products/${p.id}`).send({ annualRatePercent: '30' }).expect(409);
    expect(locked.body.error.code).toBe('PRODUCT_NOT_EDITABLE');

    await checker.client.post(`/api/v1/admin/products/${p.id}/suspend`).send({ reason: 'Rate change from the issuer' }).expect(200);
    const anon = await createClient(app);
    await anon.get(`/api/v1/investments/${p.slug}`).expect(404);

    await maker.client.patch(`/api/v1/admin/products/${p.id}`).send({ annualRatePercent: '23.75' }).expect(200);
    const re = await checker.client.post(`/api/v1/admin/products/${p.id}/publish`).expect(200);
    expect(re.body.data).toMatchObject({ version: 2, annualRatePercent: '23.75' });
    const versions = await prisma.productVersion.findMany({ where: { productId: p.id }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => v.snapshot.annualRate)).toEqual(['0.245', '0.2375']);
    await expect(prisma.productVersion.update({ where: { id: versions[0].id }, data: { version: 9 } })).rejects.toThrow(/append-only/);
  });

  it('follows the lifecycle: invalid transitions are refused', async () => {
    const p = await published();
    await checker.client.post(`/api/v1/admin/products/${p.id}/archive`).send({}).expect(409);
    await checker.client.post(`/api/v1/admin/products/${p.id}/close`).send({ reason: 'Fully subscribed' }).expect(200);
    await checker.client.post(`/api/v1/admin/products/${p.id}/publish`).expect(409);
    await checker.client.post(`/api/v1/admin/products/${p.id}/archive`).send({}).expect(200);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: p.id }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['product.created', 'product.document_added', 'product.published', 'product.closed', 'product.archived']),
    );
  });

  it('accepts only clean PDFs as product documents and retains them once published', async () => {
    const p = await draft();
    await maker.client
      .post(`/api/v1/admin/products/${p.id}/documents`)
      .field('kind', 'TERM_SHEET')
      .field('title', 'Term sheet')
      .attach('file', PNG, 'x.png')
      .expect(415);
    const added = await attachKid(p.id).expect(201);
    const docId = added.body.data.documents[0].id;
    await maker.client.delete(`/api/v1/admin/products/${p.id}/documents/${docId}`).expect(200);
    await attachKid(p.id).expect(201);
    const pub = await checker.client.post(`/api/v1/admin/products/${p.id}/publish`).expect(200);
    await checker.client.post(`/api/v1/admin/products/${p.id}/suspend`).send({ reason: 'Document refresh needed' }).expect(200);
    const res = await maker.client.delete(`/api/v1/admin/products/${p.id}/documents/${pub.body.data.documents[0].id}`).expect(409);
    expect(res.body.error.code).toBe('DOCUMENT_RETAINED');
  });

  it('records sourced, append-only historical performance', async () => {
    const p = await published({ productType: 'MONEY_MARKET_FUND', returnType: 'TARGET', termDays: null, categorySlug: 'money-market' });
    await maker.client
      .post(`/api/v1/admin/products/${p.id}/performance`)
      .send({ periodStart: '2025-01-01', periodEnd: '2025-12-31', returnPercent: '22.1' })
      .expect(422);
    await maker.client
      .post(`/api/v1/admin/products/${p.id}/performance`)
      .send({ periodStart: '2030-01-01', periodEnd: '2030-12-31', returnPercent: '22.1', source: 'Future report' })
      .expect(422);
    const ok = await maker.client
      .post(`/api/v1/admin/products/${p.id}/performance`)
      .send({ periodStart: '2025-01-01', periodEnd: '2025-12-31', returnPercent: '22.1', source: 'Audited annual report 2025' })
      .expect(201);
    expect(ok.body.data.performance[0]).toMatchObject({ returnPercent: '22.1', source: 'Audited annual report 2025' });
    await maker.client
      .post(`/api/v1/admin/products/${p.id}/performance`)
      .send({ periodStart: '2025-01-01', periodEnd: '2025-12-31', returnPercent: '30', source: 'Another figure' })
      .expect(409);
    const rec = await prisma.performanceRecord.findFirst({ where: { productId: p.id } });
    await expect(prisma.performanceRecord.update({ where: { id: rec.id }, data: { source: 'edited' } })).rejects.toThrow(/append-only/);
  });

  it('applies permissions: admins manage but cannot publish, auditors only read, investors and support are refused', async () => {
    const p = await draft();
    await attachKid(p.id).expect(201);
    await admin.client.patch(`/api/v1/admin/products/${p.id}`).send({ name: 'Renamed treasury bill' }).expect(200);
    await admin.client.post(`/api/v1/admin/products/${p.id}/publish`).expect(403);
    const auditor = await createStaffClient(['AUDITOR'], app);
    await auditor.client.get(`/api/v1/admin/products/${p.id}`).expect(200);
    await auditor.client.patch(`/api/v1/admin/products/${p.id}`).send({ name: 'Nope nope' }).expect(403);
    const support = await createStaffClient(['SUPPORT_AGENT'], app);
    await support.client.get('/api/v1/admin/products').expect(403);
    const investor = await onboardedInvestor(app, { stopBefore: 'personal' });
    await investor.client.get('/api/v1/admin/products').expect(403);
  });
});

describe('public marketplace', () => {
  it('lists only published products with search, filters, sorting and pagination', async () => {
    const tag = randomUUID().slice(0, 6);
    const low = await published({ name: `Alpha ${tag} bill`, riskLevel: 1, minInvestment: '50.00' });
    const high = await published({
      name: `Omega ${tag} equity`,
      productType: 'EQUITY_FUND',
      categorySlug: 'equities',
      returnType: 'NONE',
      annualRatePercent: null,
      termDays: null,
      riskLevel: 6,
      minRiskProfile: 'GROWTH',
      minInvestment: '1000.00',
    });
    const hidden = await draft({ name: `Hidden ${tag} draft` });
    const anon = await createClient(app);

    const all = await anon.get(`/api/v1/investments?search=${tag}&sort=risk_low`).expect(200);
    expect(all.body.data.map((p) => p.id)).toEqual([low.id, high.id]);
    expect(all.body.data.map((p) => p.id)).not.toContain(hidden.id);
    expect(all.body.data[0]).not.toHaveProperty('riskDisclosure');

    const filtered = await anon.get(`/api/v1/investments?search=${tag}&category=equities`).expect(200);
    expect(filtered.body.data.map((p) => p.id)).toEqual([high.id]);
    const safe = await anon.get(`/api/v1/investments?search=${tag}&maxRiskLevel=3`).expect(200);
    expect(safe.body.data.map((p) => p.id)).toEqual([low.id]);
    const cheapFirst = await anon.get(`/api/v1/investments?search=${tag}&sort=min_investment&pageSize=1&page=2`).expect(200);
    expect(cheapFirst.body.data.map((p) => p.id)).toEqual([high.id]);
    expect(cheapFirst.body.meta).toMatchObject({ page: 2, pageSize: 1, total: 2 });

    const cats = await anon.get('/api/v1/investments/categories').expect(200);
    expect(cats.body.data.find((c) => c.slug === 'government-securities').productCount).toBeGreaterThan(0);
  });

  it('shows upcoming and closed availability from the subscription window', async () => {
    const tag = randomUUID().slice(0, 6);
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const upcoming = await published({ name: `Upcoming ${tag}`, subscriptionOpensAt: future });
    const anon = await createClient(app);
    const res = await anon.get(`/api/v1/investments?search=${tag}&availability=UPCOMING`).expect(200);
    expect(res.body.data.map((p) => p.id)).toEqual([upcoming.id]);
    expect(res.body.data[0].availability).toBe('UPCOMING');
    await anon
      .get(`/api/v1/investments?search=${tag}&availability=OPEN`)
      .expect(200)
      .then((r) => expect(r.body.data).toHaveLength(0));
  });

  it('shows product detail, documents and eligibility for anonymous and verified visitors', async () => {
    const p = await published({ minRiskProfile: 'BALANCED' });
    const anon = await createClient(app);
    const detail = (await anon.get(`/api/v1/investments/${p.slug}`).expect(200)).body.data;
    expect(detail).toMatchObject({ riskDisclosure: RISKS.trim(), availability: 'OPEN' });
    expect(detail.eligibility).toMatchObject({ eligible: false, ordersAvailable: true });
    expect(detail.eligibility.checks.find((c) => c.key === 'signedIn').ok).toBe(false);
    const file = await anon.get(`/api/v1/investments/${p.slug}/documents/${detail.documents[0].id}`).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toMatch(/^attachment/);

    // An investor with a "moderately conservative"-capped profile sees an unsuitability flag.
    const investor = await onboardedInvestor(app, { stopBefore: 'documents' });
    await investor.client.post('/api/v1/onboarding/risk-assessment').send({
      answers: {
        horizon: '5to10',
        drawdown: 'hold',
        objective: 'growth',
        emergency_fund: 'none',
        share_of_wealth: '10to25',
        knowledge: 'good',
        income_stability: 'stable',
        loss_tolerance: 'up15',
      },
    });
    const mine = (await investor.client.get(`/api/v1/investments/${p.slug}`).expect(200)).body.data.eligibility;
    expect(mine.suitability).toMatchObject({ investorProfile: 'MODERATELY_CONSERVATIVE', productMinimum: 'BALANCED', suitable: false });
    expect(mine.checks.find((c) => c.key === 'verified').ok).toBe(false);
  });

  it('runs the calculator on the server with product terms and limits', async () => {
    const p = await published({
      annualRatePercent: '25',
      termDays: 182,
      entryFeePercent: '1',
      managementFeePercent: '2',
      minInvestment: '100.00',
      maxInvestment: '50000.00',
    });
    const anon = await createClient(app);
    const res = await anon.post('/api/v1/investments/calculator').send({ slug: p.slug, amount: '10000.00' }).expect(200);
    expect(res.body.data).toMatchObject({
      days: 182,
      entryFee: { amountMinor: '10000' },
      grossReturn: { amountMinor: '123410' },
      managementFee: { amountMinor: '9873' },
      illustrative: true,
    });
    await anon.post('/api/v1/investments/calculator').send({ slug: p.slug, amount: '50.00' }).expect(422);
    await anon.post('/api/v1/investments/calculator').send({ slug: p.slug, amount: '60000.00' }).expect(422);

    const custom = await anon
      .post('/api/v1/investments/calculator')
      .send({ amount: '1000', days: 365, annualRatePercent: '10' })
      .expect(200);
    expect(custom.body.data.endValue.amountMinor).toBe('110000');
    await anon.post('/api/v1/investments/calculator').send({ amount: '1000', annualRatePercent: '10' }).expect(422);
  });
});
