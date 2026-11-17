import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp, testLogger } from '../helpers.js';
import { createStaffClient, lastMessage } from '../auth-helpers.js';
import { PNG } from '../kyc-helpers.js';
import { available, deposit, idem, publishedProduct, verifiedInvestor } from '../payment-helpers.js';
import { createReconciliationService } from '../../src/modules/ledger/reconciliation.service.js';
import { valueHolding } from '../../src/modules/portfolio/portfolio.service.js';

let app;
let manager;
let product;
const reconciliation = createReconciliationService({ prisma, logger: testLogger });

beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
  manager = await createStaffClient(['OPERATIONS_MANAGER'], app);
  product = await publishedProduct(app); // GHS, FIXED 20% p.a., 91 days, 1% entry fee, 2% management fee
});
afterAll(() => prisma.$disconnect());

async function investedInvestor({ depositAmount = '2000.00', invest = '1000.00', register } = {}) {
  const investor = await verifiedInvestor(app, register ? { register } : {});
  await deposit(investor, depositAmount);
  const placed = await investor.client
    .post('/api/v1/investments/orders')
    .set('Idempotency-Key', idem())
    .send({ productSlug: product.slug, amount: invest, acceptRiskDisclosure: true })
    .expect(201);
  await manager.client
    .post(`/api/v1/admin/orders/${placed.body.data.id}/confirm`)
    .set('Idempotency-Key', idem())
    .send({ custodianReference: 'CSD-P7-0001' })
    .expect(200);
  return { ...investor, orderId: placed.body.data.id };
}

describe('notifications', () => {
  it('records events in the in-app centre, counts unread and marks them read', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '150.00');
    const list = await investor.client.get('/api/v1/notifications').expect(200);
    const n = list.body.data.find((x) => x.title === 'Deposit received');
    expect(n).toMatchObject({ category: 'PAYMENTS', read: false, link: '/app/transactions' });
    expect(n.body).not.toMatch(/^Hi /);
    expect(list.body.meta.unread).toBeGreaterThanOrEqual(1);

    await investor.client
      .post('/api/v1/notifications/read')
      .send({ ids: [n.id] })
      .expect(200);
    const after = await investor.client.get('/api/v1/notifications?unread=true').expect(200);
    expect(after.body.data.find((x) => x.id === n.id)).toBeUndefined();
    await investor.client.post('/api/v1/notifications/read-all').expect(200);
    expect((await investor.client.get('/api/v1/notifications/unread-count').expect(200)).body.data.count).toBe(0);
  });

  it('respects channel preferences, but security email cannot be switched off', async () => {
    const investor = await verifiedInvestor(app);
    const saved = await investor.client
      .put('/api/v1/notifications/preferences')
      .send({
        preferences: [
          { category: 'PAYMENTS', email: false, sms: true, inApp: true },
          { category: 'SECURITY', email: false, sms: false, inApp: false },
        ],
      })
      .expect(200);
    expect(saved.body.data.find((p) => p.category === 'SECURITY')).toMatchObject({ email: true, emailLocked: true, inApp: false });

    const before = await prisma.outboundMessage.count({ where: { recipient: investor.email, template: 'deposit-received' } });
    await deposit(investor, '120.00');
    expect(await prisma.outboundMessage.count({ where: { recipient: investor.email, template: 'deposit-received' } })).toBe(before);
    const sms = await prisma.outboundMessage.findFirst({
      where: { userId: investor.userId, channel: 'SMS', template: 'deposit-received' },
    });
    expect(sms.status).toBe('SENT');
    expect(sms.body).toBe('Mynx: Deposit received. Sign in for details.');
    expect(await prisma.notification.count({ where: { userId: investor.userId, template: 'deposit-received' } })).toBe(1);
  });

  it('keeps one user from reading or changing another user’s notifications', async () => {
    const a = await verifiedInvestor(app);
    const b = await verifiedInvestor(app);
    await deposit(a, '110.00');
    const mine = (await a.client.get('/api/v1/notifications').expect(200)).body.data[0];
    const res = await b.client
      .post('/api/v1/notifications/read')
      .send({ ids: [mine.id] })
      .expect(200);
    expect(res.body.data.updated).toBe(0);
  });
});

describe('portfolio valuation', () => {
  it('accrues fixed-rate holdings at the contract rate less management fee, and carries others at cost', () => {
    const h = {
      startDate: new Date('2026-01-01'),
      maturityDate: new Date('2026-04-02'),
      principalMinor: 99_000n,
      currency: 'GHS',
      status: 'ACTIVE',
    };
    const fixed = valueHolding(h, { returnType: 'FIXED', annualRate: '0.2', managementFeeRate: '0.02' }, new Date('2026-02-01T12:00:00Z'));
    // 31 days: interest 99,000 × 0.2 × 31/365 = 1,681.6 → 1,681 (down); fee 99,000 × 0.02 × 31/365 = 168.2 → 169 (up)
    expect(fixed).toMatchObject({ method: 'ACCRUED', value: 99_000n + 1_681n - 169n, unrealized: 1_512n });
    const afterMaturity = valueHolding(h, { returnType: 'FIXED', annualRate: '0.2', managementFeeRate: '0' }, new Date('2027-01-01'));
    expect(afterMaturity.accruedInterest).toBe(4_936n); // capped at maturity: 91 days
    expect(valueHolding(h, { returnType: 'TARGET', annualRate: '0.3' }, new Date('2026-02-01'))).toMatchObject({
      method: 'COST',
      value: 99_000n,
      unrealized: 0n,
    });
    expect(valueHolding(h, {}, new Date('2025-12-31'))).toBeNull();
    const matured = valueHolding(
      { ...h, status: 'MATURED', maturedAt: new Date('2026-04-02'), proceedsMinor: 104_000n, managementFeeMinor: 500n },
      {},
      new Date('2026-05-01'),
    );
    expect(matured).toMatchObject({ method: 'SETTLED', value: 0n, realized: 4_500n });
  });

  it('builds the dashboard from ledger and holding records', async () => {
    const investor = await investedInvestor();
    const d = (await investor.client.get('/api/v1/portfolio/dashboard').expect(200)).body.data;
    expect(d.verification).toBe('APPROVED');
    expect(d.wallet.available.amountMinor).toBe(await available(investor.client));
    expect(d.portfolio.investedCapital.amountMinor).toBe('99000'); // 1,000.00 less the 1% entry fee
    expect(d.portfolio.feesPaid.amountMinor).toBe('1000');
    expect(BigInt(d.portfolio.totalValue.amountMinor)).toBe(
      BigInt(d.wallet.available.amountMinor) + BigInt(d.wallet.reserved.amountMinor) + BigInt(d.portfolio.holdingsValue.amountMinor),
    );
    expect(d.counts).toMatchObject({ activeHoldings: 1, pendingOrders: 0, completedHoldings: 0 });
    expect(d.allocation.byType[0]).toMatchObject({ key: 'TREASURY_BILL', shareBasisPoints: 10_000 });
    expect(d.upcomingMaturities[0].daysToMaturity).toBe(91);
    expect(d.recentTransactions.length).toBeGreaterThan(0);
    expect(d.notifications.unread).toBeGreaterThan(0);

    const holdings = (await investor.client.get('/api/v1/portfolio/holdings').expect(200)).body.data;
    expect(holdings[0]).toMatchObject({ valuationMethod: 'ACCRUED', annualRatePercent: '20', principal: { amountMinor: '99000' } });

    const history = (await investor.client.get('/api/v1/portfolio/history').expect(200)).body.data;
    expect(history.at(-1).totalMinor).toBe(d.portfolio.totalValue.amountMinor);
  });

  it('reports cash flows and fees over a period, and rejects bad ranges', async () => {
    const investor = await investedInvestor();
    const today = new Date().toISOString().slice(0, 10);
    const a = (await investor.client.get(`/api/v1/portfolio/analytics?from=${today}&to=${today}`).expect(200)).body.data;
    const deposits = a.cashFlows.find((f) => f.type === 'DEPOSIT');
    expect(deposits.netMinor).toBe('200000');
    expect(a.cashFlows.find((f) => f.type === 'RESERVATION').netMinor).toBe('-100000');
    expect(a.fees.entry.amountMinor).toBe('1000');
    expect(a.riskExposure[0].label).toBe('Risk 2');
    await investor.client.get('/api/v1/portfolio/analytics?from=2026-05-01&to=2026-01-01').expect(422);
  });
});

describe('statements and documents', () => {
  it('generates, versions and downloads statements through signed, user-bound links', async () => {
    const investor = await investedInvestor();
    const other = await verifiedInvestor(app);
    const today = new Date().toISOString().slice(0, 10);
    const gen = (body) => investor.client.post('/api/v1/statements').send(body);

    const pdf = (await gen({ kind: 'ACCOUNT_STATEMENT', from: today, to: today }).expect(201)).body.data;
    expect(pdf).toMatchObject({ kind: 'ACCOUNT_STATEMENT', format: 'PDF', version: 1 });
    const again = (await gen({ kind: 'ACCOUNT_STATEMENT', from: today, to: today }).expect(201)).body.data;
    expect(again.version).toBe(2);

    const { url } = (await investor.client.get(`/api/v1/statements/${pdf.id}/download-url`).expect(200)).body.data;
    const file = await investor.client.get(url).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    const text = file.body.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Account statement');
    expect(text).toContain('SANDBOX');
    // The xref offsets point at real objects, so viewers can open the file.
    const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');

    await other.client.get(url).expect(403);
    await other.client.get(`/api/v1/statements/${pdf.id}/download-url`).expect(404);

    const csv = (await gen({ kind: 'ACCOUNT_STATEMENT', format: 'CSV', from: today, to: today }).expect(201)).body.data;
    const csvUrl = (await investor.client.get(`/api/v1/statements/${csv.id}/download-url`).expect(200)).body.data.url;
    const rows = (await investor.client.get(csvUrl).expect(200)).text.trim().split('\r\n');
    expect(rows[1]).toContain('Opening balance');
    const closing = rows.at(-1).split(',').at(-1);
    expect(closing).toBe((Number(await available(investor.client)) / 100).toFixed(2));

    const actions = await prisma.generatedDocumentAccess.findMany({ where: { documentId: pdf.id }, orderBy: { id: 'asc' } });
    expect(actions.map((a) => a.action)).toEqual(['GENERATED', 'URL_ISSUED', 'DOWNLOADED']);
    await expect(prisma.generatedDocument.update({ where: { id: pdf.id }, data: { title: 'x' } })).rejects.toThrow(/append-only/);
  });

  it('issues confirmations and receipts only for settled records the investor owns', async () => {
    const investor = await investedInvestor();
    const other = await verifiedInvestor(app);
    await investor.client.post('/api/v1/statements').send({ kind: 'INVESTMENT_CONFIRMATION', referenceId: investor.orderId }).expect(201);
    await other.client.post('/api/v1/statements').send({ kind: 'INVESTMENT_CONFIRMATION', referenceId: investor.orderId }).expect(404);
    await investor.client
      .post('/api/v1/statements')
      .send({ kind: 'INVESTMENT_CONFIRMATION', referenceId: investor.orderId, format: 'CSV' })
      .expect(422);

    const pending = await investor.client
      .post('/api/v1/wallet/deposits')
      .set('Idempotency-Key', idem())
      .send({ amount: '50.00' })
      .expect(201);
    const res = await investor.client
      .post('/api/v1/statements')
      .send({ kind: 'DEPOSIT_RECEIPT', referenceId: pending.body.data.id })
      .expect(409);
    expect(res.body.error.code).toBe('NOT_SETTLED');
    const portfolioPdf = await investor.client.post('/api/v1/statements').send({ kind: 'PORTFOLIO_STATEMENT' }).expect(201);
    expect(portfolioPdf.body.data.title).toMatch(/^Portfolio statement as of/);
  });
});

describe('referrals', () => {
  let adminA;
  let adminB;
  beforeAll(async () => {
    adminA = await createStaffClient(['ADMIN'], app);
    adminB = await createStaffClient(['ADMIN'], app);
    await prisma.referralCampaign.updateMany({ where: { active: true }, data: { active: false } });
  });

  it('needs a second person to activate a campaign', async () => {
    const c = await adminA.client
      .post('/api/v1/admin/referrals/campaigns')
      .send({
        name: 'Test campaign',
        reward: '25.00',
        minInvestment: '500.00',
        maxRewardsPerReferrer: 5,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(201);
    expect(c.body.data.active).toBe(false);
    await adminA.client.post(`/api/v1/admin/referrals/campaigns/${c.body.data.id}/activate`).expect(403);
    const on = await adminB.client.post(`/api/v1/admin/referrals/campaigns/${c.body.data.id}/activate`).expect(200);
    expect(on.body.data.active).toBe(true);
  });

  it('attributes at sign-up, holds flagged referrals for review, then pays through the ledger', async () => {
    const referrer = await verifiedInvestor(app);
    const overview = (await referrer.client.get('/api/v1/referrals').expect(200)).body.data;
    expect(overview.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(overview.link).toContain(`/register?ref=${overview.code}`);
    expect(overview.campaign.reward.amountMinor).toBe('2500');

    // The friend signs up from the same network as the referrer (both 127.0.0.1 in tests): flagged, never auto-paid.
    const friend = await investedInvestor({ register: { referralCode: overview.code.toLowerCase() } });
    const referral = await prisma.referral.findUnique({ where: { referredUserId: friend.userId } });
    expect(referral).toMatchObject({ referrerId: referrer.userId, status: 'QUALIFIED' });
    expect(referral.flags).toContain('SHARED_NETWORK');
    const view = (await referrer.client.get('/api/v1/referrals').expect(200)).body.data.referrals[0];
    expect(view).toMatchObject({ status: 'QUALIFIED', note: 'Being checked by our team' });
    expect(view.friend).toBe('Ama M.');
    expect(JSON.stringify(view)).not.toContain('SHARED_NETWORK');

    const before = BigInt(await available(referrer.client));
    await adminA.client
      .post(`/api/v1/admin/referrals/${referral.id}/decide`)
      .send({ approve: true, note: 'Checked: different households' })
      .expect(200);
    expect(BigInt(await available(referrer.client))).toBe(before + 2500n);
    const reward = await prisma.referralReward.findUnique({ where: { referralId: referral.id } });
    expect(reward.amountMinor).toBe(2500n);
    expect(await lastMessage(referrer.email, 'referral-reward')).toBeTruthy();
    await adminA.client.post(`/api/v1/admin/referrals/${referral.id}/decide`).send({ approve: true, note: 'Second attempt' }).expect(409);
    const run = await reconciliation.runLedgerIntegrity();
    expect(run.status).toBe('PASSED');
  });

  it('pays automatically when nothing is flagged, and ignores unknown codes', async () => {
    const referrer = await verifiedInvestor(app);
    const { code } = (await referrer.client.get('/api/v1/referrals').expect(200)).body.data;
    // Remove the shared-network signal for this referrer so the automatic path runs.
    await prisma.loginAttempt.deleteMany({ where: { userId: referrer.userId } });
    const before = BigInt(await available(referrer.client));
    const friend = await investedInvestor({ register: { referralCode: code } });
    expect((await prisma.referral.findUnique({ where: { referredUserId: friend.userId } })).status).toBe('REWARDED');
    expect(BigInt(await available(referrer.client))).toBe(before + 2500n);

    const stranger = await verifiedInvestor(app, { register: { referralCode: 'NOSUCHCODE' } });
    expect(await prisma.referral.findUnique({ where: { referredUserId: stranger.userId } })).toBeNull();
  });

  it('keeps a friend pending until they invest the campaign minimum', async () => {
    const referrer = await verifiedInvestor(app);
    const { code } = (await referrer.client.get('/api/v1/referrals').expect(200)).body.data;
    const friend = await investedInvestor({ register: { referralCode: code }, invest: '200.00' });
    expect((await prisma.referral.findUnique({ where: { referredUserId: friend.userId } })).status).toBe('PENDING');
    await expect(
      prisma.referral.updateMany({ where: { referredUserId: friend.userId }, data: { referrerId: friend.userId } }),
    ).rejects.toThrow();
  });
});

describe('support', () => {
  let agent;
  let admin;
  beforeAll(async () => {
    agent = await createStaffClient(['SUPPORT_AGENT'], app);
    admin = await createStaffClient(['ADMIN'], app);
  });

  it('runs a ticket from creation to closure, keeping internal notes and finances away from the customer', async () => {
    const investor = await verifiedInvestor(app);
    const other = await verifiedInvestor(app);
    const created = await investor.client
      .post('/api/v1/support/tickets')
      .field('category', 'WITHDRAWALS')
      .field('subject', 'Withdrawal still pending')
      .field('body', 'My withdrawal has been under review for two days.')
      .attach('files', PNG, 'screenshot.png')
      .expect(201);
    const t = created.body.data;
    expect(t).toMatchObject({ status: 'OPEN', priority: 'NORMAL', isComplaint: false });
    expect(t.messages[0].attachments).toHaveLength(1);
    expect(await lastMessage(investor.email, 'ticket-created')).toBeTruthy();

    const queue = (await agent.client.get('/api/v1/admin/support/tickets?assignee=unassigned').expect(200)).body.data;
    expect(queue.some((x) => x.id === t.id)).toBe(true);
    const staffView = (await agent.client.get(`/api/v1/admin/support/tickets/${t.id}`).expect(200)).body.data;
    expect(staffView.customer.email).toBe(investor.email);
    expect(JSON.stringify(staffView)).not.toMatch(/amountMinor|balance|kycStatus|identityNumber|riskRating/i);
    // Agents cannot reach financial records.
    await agent.client.get(`/api/v1/admin/wallets/${investor.userId}`).expect(403);

    await agent.client
      .post(`/api/v1/admin/support/tickets/${t.id}/messages`)
      .field('body', 'Checked with finance: approval pending.')
      .field('internal', 'true')
      .expect(201);
    const replied = await agent.client
      .post(`/api/v1/admin/support/tickets/${t.id}/messages`)
      .field('body', 'We are looking into it.')
      .expect(201);
    expect(replied.body.data).toMatchObject({ status: 'AWAITING_CUSTOMER', assignee: { id: agent.userId } });
    expect(replied.body.data.firstResponseAt).toBeTruthy();
    expect(await lastMessage(investor.email, 'ticket-reply')).toBeTruthy();

    const mine = (await investor.client.get(`/api/v1/support/tickets/${t.id}`).expect(200)).body.data;
    expect(mine.messages.map((m) => m.body)).toEqual(['My withdrawal has been under review for two days.', 'We are looking into it.']);

    const attachmentId = t.messages[0].attachments[0].id;
    await investor.client.get(`/api/v1/support/attachments/${attachmentId}`).expect(200);
    await agent.client.get(`/api/v1/support/attachments/${attachmentId}`).expect(200);
    await other.client.get(`/api/v1/support/attachments/${attachmentId}`).expect(404);
    await other.client.get(`/api/v1/support/tickets/${t.id}`).expect(404);

    const reopened = await investor.client
      .post(`/api/v1/support/tickets/${t.id}/messages`)
      .field('body', 'Thanks, any update?')
      .expect(201);
    expect(reopened.body.data.status).toBe('OPEN');
    await agent.client.patch(`/api/v1/admin/support/tickets/${t.id}`).send({ status: 'RESOLVED' }).expect(200);
    await investor.client.post(`/api/v1/support/tickets/${t.id}/close`).expect(200);
    await investor.client.post(`/api/v1/support/tickets/${t.id}/messages`).field('body', 'One more thing').expect(409);
    await agent.client.patch(`/api/v1/admin/support/tickets/${t.id}`).send({ status: 'OPEN' }).expect(409);
    await expect(prisma.supportMessage.updateMany({ where: { ticketId: t.id }, data: { body: 'edited' } })).rejects.toThrow(/append-only/);
  });

  it('requires a recorded resolution before a complaint is resolved', async () => {
    const investor = await verifiedInvestor(app);
    const c = await investor.client
      .post('/api/v1/support/tickets')
      .field('category', 'COMPLAINT')
      .field('priority', 'LOW')
      .field('subject', 'Unhappy with fees')
      .field('body', 'The entry fee was not clear to me.')
      .expect(201);
    expect(c.body.data).toMatchObject({ isComplaint: true, priority: 'NORMAL' });
    const res = await agent.client.patch(`/api/v1/admin/support/tickets/${c.body.data.id}`).send({ status: 'RESOLVED' }).expect(422);
    expect(res.body.error.details[0].path).toBe('resolution');
    await agent.client
      .patch(`/api/v1/admin/support/tickets/${c.body.data.id}`)
      .send({ status: 'RESOLVED', resolution: 'Explained the fee schedule and updated the product page wording.' })
      .expect(200);
    const today = new Date().toISOString().slice(0, 10);
    const report = (await agent.client.get(`/api/v1/admin/support/report?from=${today}&to=${today}`).expect(200)).body.data;
    expect(report.created).toBeGreaterThanOrEqual(2);
    expect(report.complaints.total).toBeGreaterThanOrEqual(1);
    expect(report.avgFirstResponseMinutes).not.toBeNull();
  });

  it('publishes only approved FAQ entries', async () => {
    const draft = await admin.client
      .post('/api/v1/admin/support/faqs')
      .send({ category: 'Deposits', question: 'How long do deposits take?', answer: 'Usually a few minutes.' })
      .expect(201);
    const publicList = async () => (await investorFaqs()).map((f) => f.id);
    const investorFaqs = async () => (await (await import('supertest')).default(app).get('/api/v1/support/faqs').expect(200)).body.data;
    expect(await publicList()).not.toContain(draft.body.data.id);
    await admin.client
      .put(`/api/v1/admin/support/faqs/${draft.body.data.id}`)
      .send({ category: 'Deposits', question: 'How long do deposits take?', answer: 'Usually a few minutes.', published: true })
      .expect(200);
    expect(await publicList()).toContain(draft.body.data.id);
    await agent.client
      .post('/api/v1/admin/support/faqs')
      .send({ category: 'X', question: 'Agents cannot edit FAQs?', answer: 'Correct.' })
      .expect(403);
  });
});
