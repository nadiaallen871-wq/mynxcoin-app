import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers.js';
import { createStaffClient } from '../auth-helpers.js';
import { deposit, idem, verifiedInvestor } from '../payment-helpers.js';

let app;
let admin; // settings:manage (maker)
let ops; // approvals:decide (checker)
let superAdmin;
let compliance;

beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
  admin = await createStaffClient(['ADMIN'], app);
  ops = await createStaffClient(['OPERATIONS_MANAGER'], app);
  superAdmin = await createStaffClient(['SUPER_ADMIN'], app);
  compliance = await createStaffClient(['COMPLIANCE_OFFICER'], app);
});
afterAll(() => prisma.$disconnect());

const propose = (key, value, reason = 'Testing the approval workflow') =>
  admin.client.post(`/api/v1/admin/settings/${key}/proposals`).send({ value, reason });
const decide = (client, id, approve = true, note = 'Checked') =>
  client.client.post(`/api/v1/admin/approvals/${id}/decide`).send({ approve, note });
const setting = async (key) => (await admin.client.get('/api/v1/admin/settings').expect(200)).body.data.find((s) => s.key === key);

/** Changes a setting through the full maker-checker flow. */
async function change(key, value) {
  const p = await propose(key, value).expect(202);
  const d = await decide(ops, p.body.data.id).expect(200);
  expect(d.body.data.status).toBe('APPROVED');
}

describe('system settings with maker-checker', () => {
  it('applies a change only after a different person approves it', async () => {
    const p = await propose('platform.announcement', 'Scheduled maintenance on Sunday 02:00 GMT').expect(202);
    expect(p.body.data).toMatchObject({ type: 'SETTING_CHANGE', status: 'PENDING' });
    expect((await setting('platform.announcement')).pending.id).toBe(p.body.data.id);
    expect((await request(app).get('/api/v1/platform').expect(200)).body.data.announcement).toBeNull();

    await decide(admin, p.body.data.id).expect(403); // the requester (also lacks approvals:decide)
    const sa = await decide(superAdmin, p.body.data.id).expect(200);
    expect(sa.body.data.status).toBe('APPROVED');
    expect((await request(app).get('/api/v1/platform').expect(200)).body.data.announcement).toBe(
      'Scheduled maintenance on Sunday 02:00 GMT',
    );
    const log = await prisma.auditLog.findFirst({ where: { action: 'approval.approved', entityId: p.body.data.id } });
    expect(log.after).toMatchObject({ key: 'platform.announcement', to: 'Scheduled maintenance on Sunday 02:00 GMT' });
    await change('platform.announcement', '');
  });

  it('validates values, blocks duplicates and non-editable settings', async () => {
    const tooLow = await propose('payments.deposit_max_minor', 500).expect(422);
    expect(tooLow.body.error.details[0].message).toMatch(/at least|below the minimum/);
    await propose('platform.go_live_approved', true).expect(409);
    await propose('platform.unknown_key', true).expect(422);
    await propose('platform.maintenance_mode', 'yes').expect(422);
    await admin.client.post('/api/v1/admin/settings/platform.announcement/proposals').send({ value: 'x', reason: 'short' }).expect(422);

    const first = await propose('support.first_response_target_hours', 12).expect(202);
    const dup = await propose('support.first_response_target_hours', 8).expect(409);
    expect(dup.body.error.code).toBe('ALREADY_PENDING');
    await admin.client.post(`/api/v1/admin/approvals/${first.body.data.id}/cancel`).expect(200);
  });

  it('marks a request FAILED instead of applying it when the setting changed meanwhile', async () => {
    const p = await propose('support.first_response_target_hours', 36).expect(202);
    await change('platform.announcement', 'Interim notice');
    // Someone else changed this same setting after the request was made.
    await prisma.systemSetting.upsert({
      where: { key: 'support.first_response_target_hours' },
      create: { key: 'support.first_response_target_hours', value: 30, version: 5 },
      update: { value: 30, version: { increment: 1 } },
    });
    const d = await decide(ops, p.body.data.id).expect(200);
    expect(d.body.data).toMatchObject({ status: 'FAILED' });
    expect(d.body.data.error).toMatch(/changed after this request/);
    expect((await setting('support.first_response_target_hours')).value).toBe(30);
    await prisma.systemSetting.delete({ where: { key: 'support.first_response_target_hours' } });
    await change('platform.announcement', '');
  });

  it('enforces maintenance mode on investor money movements only', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '100.00');
    await change('platform.maintenance_mode', true);
    try {
      const res = await investor.client
        .post('/api/v1/wallet/deposits')
        .set('Idempotency-Key', idem())
        .send({ amount: '50.00' })
        .expect(503);
      expect(res.body.error.code).toBe('MAINTENANCE');
      await investor.client.get('/api/v1/wallet').expect(200);
      expect((await request(app).get('/api/v1/platform').expect(200)).body.data.maintenance).toBe(true);
    } finally {
      await change('platform.maintenance_mode', false);
    }
    await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', idem()).send({ amount: '50.00' }).expect(201);
  });

  it('uses approved payment limits instead of the environment defaults', async () => {
    const investor = await verifiedInvestor(app);
    await change('payments.deposit_min_minor', 2500);
    try {
      const res = await investor.client
        .post('/api/v1/wallet/deposits')
        .set('Idempotency-Key', idem())
        .send({ amount: '20.00' })
        .expect(422);
      expect(res.body.error.message).toContain('GHS 25.00');
    } finally {
      await prisma.systemSetting.delete({ where: { key: 'payments.deposit_min_minor' } });
    }
  });
});

describe('privileged role grants', () => {
  it('needs a second approver with roles:manage to grant the Administrator role', async () => {
    const target = await createStaffClient(['AUDITOR'], app);
    await superAdmin.client.post(`/api/v1/admin/users/${target.userId}/roles`).send({ roleKey: 'ADMIN' }).expect(422);
    const req = await superAdmin.client
      .post(`/api/v1/admin/users/${target.userId}/roles`)
      .send({ roleKey: 'ADMIN', reason: 'Covers platform administration while the team grows' })
      .expect(202);
    const id = req.body.data.pendingApproval.id;
    expect(await prisma.userRole.count({ where: { userId: target.userId, role: { key: 'ADMIN' } } })).toBe(0);
    await decide(superAdmin, id).expect(403); // requester
    const opsDecision = await decide(ops, id).expect(403); // lacks roles:manage
    expect(opsDecision.body.error.message).toMatch(/roles:manage/);
    const otherSuper = await createStaffClient(['SUPER_ADMIN'], app);
    await decide(otherSuper, id).expect(200);
    expect(await prisma.userRole.count({ where: { userId: target.userId, role: { key: 'ADMIN' } } })).toBe(1);
    // Ordinary roles are still granted directly.
    await superAdmin.client.post(`/api/v1/admin/users/${target.userId}/roles`).send({ roleKey: 'SUPPORT_AGENT' }).expect(200);
  });
});

describe('transaction monitoring and compliance cases', () => {
  it('raises alerts for pass-through activity and runs a case to closure', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '1000.00');
    const w = await investor.client
      .post('/api/v1/wallet/withdrawals')
      .set('Idempotency-Key', idem())
      .send({
        amount: '900.00',
        method: 'MOBILE_MONEY',
        destination: { network: 'MTN', accountNumber: '0241234567', accountName: 'Ama Mensah' },
      })
      .expect(201);
    // Filter by person: other test files leave many alerts, so the first page alone is not enough.
    const alerts = (await compliance.client.get(`/api/v1/admin/compliance/alerts?status=OPEN&userId=${investor.userId}`).expect(200)).body
      .data;
    expect(alerts.map((a) => a.rule).sort()).toEqual(['PASS_THROUGH', 'WITHDRAWAL_RISK_FLAGS']);
    const pass = alerts.find((a) => a.rule === 'PASS_THROUGH');
    expect(pass).toMatchObject({ severity: 'HIGH', referenceId: w.body.data.id });

    const flags = alerts.find((a) => a.rule === 'WITHDRAWAL_RISK_FLAGS');
    await compliance.client
      .post(`/api/v1/admin/compliance/alerts/${flags.id}/dismiss`)
      .send({ note: 'Covered by the pass-through review' })
      .expect(200);
    await compliance.client.post(`/api/v1/admin/compliance/alerts/${flags.id}/dismiss`).send({ note: 'Again' }).expect(409);

    const escalated = await compliance.client
      .post(`/api/v1/admin/compliance/alerts/${pass.id}/escalate`)
      .send({ note: 'Needs source-of-funds review', type: 'AML' })
      .expect(201);
    const c = escalated.body.data;
    expect(c).toMatchObject({ type: 'AML', priority: 'HIGH', status: 'OPEN' });
    expect(c.alerts).toHaveLength(1);
    expect(c.subjectProfile.kycStatus).toBe('APPROVED');

    const base = `/api/v1/admin/compliance/cases/${c.id}`;
    await compliance.client.post(`${base}/notes`).send({ body: 'Requested payslips from the investor.' }).expect(201);
    await compliance.client.post(`${base}/risk-rating`).send({ riskRating: 'HIGH', reason: 'Rapid in-and-out movement' }).expect(200);
    expect((await prisma.investorProfile.findUnique({ where: { userId: investor.userId } })).riskRating).toBe('HIGH');
    await compliance.client.post(`${base}/wallet`).send({ frozen: true, reason: 'Pending source-of-funds review' }).expect(200);
    const blocked = await investor.client.post('/api/v1/wallet/deposits').set('Idempotency-Key', idem()).send({ amount: '50.00' });
    expect([403, 409, 423]).toContain(blocked.status);
    await compliance.client.post(`${base}/report`).send({ reference: 'FIC-STR-2026-0001' }).expect(200);
    await compliance.client.post(`${base}/report`).send({ reference: 'FIC-STR-2026-0002' }).expect(409);

    const noOutcome = await compliance.client.patch(base).send({ status: 'CLOSED_ACTION_TAKEN' }).expect(422);
    expect(noOutcome.body.error.details[0].path).toBe('outcome');
    const closed = await compliance.client
      .patch(base)
      .send({ status: 'CLOSED_ACTION_TAKEN', outcome: 'Report filed; wallet frozen pending documents.' })
      .expect(200);
    expect(closed.body.data.status).toBe('CLOSED_ACTION_TAKEN');
    expect(closed.body.data.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining([
        'OPENED',
        'ALERT_LINKED',
        'NOTE',
        'RISK_RATING_CHANGED',
        'WALLET_FROZEN',
        'REPORT_RECORDED',
        'STATUS_CHANGED',
        'OUTCOME_RECORDED',
      ]),
    );
    await expect(prisma.complianceCaseEvent.deleteMany({ where: { caseId: c.id } })).rejects.toThrow(/append-only/);
  });

  it('keeps support agents and investors out of compliance data', async () => {
    const agent = await createStaffClient(['SUPPORT_AGENT'], app);
    await agent.client.get('/api/v1/admin/compliance/alerts').expect(403);
    await agent.client.get('/api/v1/admin/compliance/cases').expect(403);
    const investor = await verifiedInvestor(app);
    await investor.client.get('/api/v1/admin/compliance/cases').expect(403);
  });

  it('raises a large-deposit alert above the configured threshold', async () => {
    const investor = await verifiedInvestor(app);
    await deposit(investor, '25000.00'); // default threshold GH₵ 20,000
    const alert = await prisma.monitoringAlert.findFirst({ where: { userId: investor.userId, rule: 'LARGE_DEPOSIT' } });
    expect(alert).toMatchObject({ severity: 'MEDIUM', status: 'OPEN' });
  });
});

describe('overview, audit viewer, reports and message log', () => {
  it('shows each staff member only the overview sections their permissions cover', async () => {
    const full = (await superAdmin.client.get('/api/v1/admin/overview').expect(200)).body.data;
    expect(full.money.customerWalletLiability.amountMinor).toMatch(/^\d+$/);
    expect(full.users.byType.INDIVIDUAL).toBeGreaterThan(0);
    expect(full.pending).toHaveProperty('approvalRequests');
    expect(full.recentActivity.length).toBeGreaterThan(0);

    const agent = await createStaffClient(['SUPPORT_AGENT'], app);
    const limited = (await agent.client.get('/api/v1/admin/overview').expect(200)).body.data;
    expect(limited).toMatchObject({ users: null, kyc: null, money: null, investments: null, compliance: null, recentActivity: null });
    expect(Object.keys(limited.pending)).toEqual(['unassignedTickets']);
  });

  it('filters, opens and exports the audit log, and audits the export', async () => {
    const list = await superAdmin.client.get('/api/v1/admin/audit?action=approval.&pageSize=5').expect(200);
    expect(list.body.data.every((r) => r.action.startsWith('approval.'))).toBe(true);
    const detail = await superAdmin.client.get(`/api/v1/admin/audit/${list.body.data[0].id}`).expect(200);
    expect(detail.body.data).toHaveProperty('after');
    const csv = await superAdmin.client.get('/api/v1/admin/audit/export?action=approval.').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toBe('ID,Time (UTC),Actor,Action,Entity type,Entity ID,IP address,Request ID,Before,After,Metadata');
    expect(await prisma.auditLog.count({ where: { action: 'audit.exported', actorId: superAdmin.userId } })).toBe(1);
    await compliance.client.get('/api/v1/admin/audit/export').expect(200);
    const agent = await createStaffClient(['SUPPORT_AGENT'], app);
    await agent.client.get('/api/v1/admin/audit').expect(403);
  });

  it('builds reports as JSON and CSV for a period', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const fin = (await ops.client.get(`/api/v1/admin/reports/financial-summary?from=${today}&to=${today}`).expect(200)).body.data;
    expect(Number(fin.totals.deposits)).toBeGreaterThan(0);
    const csv = await ops.client.get(`/api/v1/admin/reports/transactions?from=${today}&to=${today}&format=csv`).expect(200);
    expect(csv.text.split('\r\n')[0]).toBe('Entry,Posted at (UTC),Type,Description,Reference,Amount,Currency');
    await ops.client.get(`/api/v1/admin/reports/investors?from=${today}&to=${today}`).expect(200);
    await ops.client.get(`/api/v1/admin/reports/investments?from=${today}&to=${today}`).expect(200);
    await ops.client.get('/api/v1/admin/reports/nope?from=2026-01-01&to=2026-01-02').expect(422);
    await ops.client.get('/api/v1/admin/reports/investors?from=2024-01-01&to=2026-01-02').expect(422);
  });

  it('lists deliveries with masked recipients and retries failed messages without secrets', async () => {
    const investor = await verifiedInvestor(app);
    const failed = await prisma.outboundMessage.create({
      data: {
        userId: investor.userId,
        channel: 'EMAIL',
        recipient: investor.email,
        template: 'deposit-received',
        subject: 'Deposit received',
        body: 'x',
        status: 'FAILED',
        attempts: 10,
        lastError: 'SMTP timeout',
      },
    });
    const secret = await prisma.outboundMessage.create({
      data: {
        userId: investor.userId,
        channel: 'EMAIL',
        recipient: investor.email,
        template: 'password-reset',
        subject: 'Reset',
        body: 'link',
        containsSecret: true,
        status: 'FAILED',
        attempts: 10,
      },
    });
    const list = (await superAdmin.client.get('/api/v1/admin/messages?status=FAILED').expect(200)).body;
    const row = list.data.find((m) => m.id === failed.id);
    expect(row.recipient).toMatch(/^k\*\*\*@example\.test$/);
    expect(row).not.toHaveProperty('body');
    await superAdmin.client.post(`/api/v1/admin/messages/${failed.id}/retry`).expect(200);
    expect((await prisma.outboundMessage.findUnique({ where: { id: failed.id } })).status).toBe('SENT');
    await superAdmin.client.post(`/api/v1/admin/messages/${secret.id}/retry`).expect(409);
    const ops2 = await createStaffClient(['FINANCE_OFFICER'], app);
    await ops2.client.get('/api/v1/admin/messages').expect(403);
  });
});
