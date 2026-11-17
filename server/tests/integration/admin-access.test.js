import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { buildTestApp } from '../helpers.js';
import {
  PASSWORD,
  createClient,
  createStaffClient,
  lastMessage,
  login,
  registerVerified,
  tokenFromMessage,
  uniqueEmail,
} from '../auth-helpers.js';

// The test DB persists between runs, so custom role keys get a per-run suffix.
const RUN = Date.now().toString(36).toUpperCase();
let app;
let admin;
beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
  admin = await createStaffClient(['SUPER_ADMIN'], app);
});
afterAll(() => prisma.$disconnect());

describe('permission enforcement', () => {
  it('rejects anonymous and investor access to admin endpoints', async () => {
    const anon = await createClient(app);
    await anon.get('/api/v1/admin/users').expect(401);

    const investor = await createClient(app);
    const { email } = await registerVerified(investor);
    await login(investor, email).expect(200);
    const res = await investor.get('/api/v1/admin/users').expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('requires staff to have completed MFA in the session', async () => {
    const email = uniqueEmail('nomfa');
    const role = await prisma.role.findUnique({ where: { key: 'AUDITOR' } });
    await prisma.user.create({
      data: {
        email,
        type: 'STAFF',
        status: 'ACTIVE',
        passwordHash: await hashPassword(PASSWORD),
        emailVerifiedAt: new Date(),
        roles: { create: { roleId: role.id } },
      },
    });
    const client = await createClient(app);
    await login(client, email).expect(200);
    const res = await client.get('/api/v1/admin/users').expect(403);
    expect(res.body.error.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('scopes staff to their role: auditors read but cannot change, support agents cannot list users', async () => {
    const auditor = await createStaffClient(['AUDITOR'], app);
    await auditor.client.get('/api/v1/admin/users').expect(200);
    await auditor.client.get('/api/v1/admin/roles').expect(200);
    await auditor.client.post(`/api/v1/admin/users/${admin.userId}/suspend`).send({ reason: 'testing access' }).expect(403);

    const support = await createStaffClient(['SUPPORT_AGENT'], app);
    await support.client.get('/api/v1/admin/users').expect(403);
  });

  it('applies role changes immediately', async () => {
    const staff = await createStaffClient(['AUDITOR'], app);
    await staff.client.get('/api/v1/admin/users').expect(200);
    await admin.client.delete(`/api/v1/admin/users/${staff.userId}/roles/AUDITOR`).expect(200);
    await staff.client.get('/api/v1/admin/users').expect(403);
  });
});

describe('user administration', () => {
  it('lists and searches users with pagination', async () => {
    const investor = await createClient(app);
    const { email } = await registerVerified(investor, { firstName: 'Searchable' });
    const res = await admin.client.get('/api/v1/admin/users?search=searchable&pageSize=5').expect(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5 });
    expect(res.body.data.map((u) => u.email)).toContain(email);
    expect(res.body.data[0]).not.toHaveProperty('passwordHash');
  });

  it('invites staff with a setup link; the invitee sets a password and becomes active', async () => {
    const email = uniqueEmail('invitee');
    const res = await admin.client
      .post('/api/v1/admin/users')
      .send({ email, firstName: 'Efua', lastName: 'Owusu', roleKeys: ['COMPLIANCE_OFFICER'] })
      .expect(201);
    expect(res.body.data).toMatchObject({ email, type: 'STAFF', status: 'PENDING_VERIFICATION', roles: ['COMPLIANCE_OFFICER'] });

    const token = tokenFromMessage(await lastMessage(email, 'account-setup'));
    const invitee = await createClient(app);
    await invitee.post('/api/v1/auth/reset-password').send({ token, password: 'compliance officer passphrase' }).expect(200);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user.status).toBe('ACTIVE');
    expect(user.emailVerifiedAt).not.toBeNull();
    await login(invitee, email, 'compliance officer passphrase').expect(200);

    await admin.client
      .post('/api/v1/admin/users')
      .send({ email, firstName: 'X', lastName: 'Y', roleKeys: ['AUDITOR'] })
      .expect(409);
  });

  it('refuses investor roles for staff and staff roles for investors', async () => {
    const res = await admin.client
      .post('/api/v1/admin/users')
      .send({ email: uniqueEmail(), firstName: 'A', lastName: 'B', roleKeys: ['INDIVIDUAL_INVESTOR'] })
      .expect(400);
    expect(res.body.error.code).toBe('ROLE_TYPE_MISMATCH');

    const investor = await createClient(app);
    const { userId } = await registerVerified(investor);
    const assign = await admin.client.post(`/api/v1/admin/users/${userId}/roles`).send({ roleKey: 'FINANCE_OFFICER' }).expect(400);
    expect(assign.body.error.code).toBe('ROLE_TYPE_MISMATCH');
  });

  it('enforces separation of duties across combined roles', async () => {
    await admin.client
      .post('/api/v1/admin/roles')
      .send({ key: `ADJUSTMENT_APPROVER_${RUN}`, name: 'Adjustment approver', permissions: ['ledger:read', 'ledger:adjustment:approve'] })
      .expect(201);
    const finance = await createStaffClient(['FINANCE_OFFICER'], app);
    const res = await admin.client
      .post(`/api/v1/admin/users/${finance.userId}/roles`)
      .send({ roleKey: `ADJUSTMENT_APPROVER_${RUN}` })
      .expect(409);
    expect(res.body.error.code).toBe('SEPARATION_OF_DUTIES');
  });

  it('prevents staff from changing their own roles or suspending themselves', async () => {
    await admin.client.post(`/api/v1/admin/users/${admin.userId}/roles`).send({ roleKey: 'AUDITOR' }).expect(403);
    await admin.client.post(`/api/v1/admin/users/${admin.userId}/suspend`).send({ reason: 'self suspension' }).expect(403);
  });

  it('suspends a user (revoking sessions) and reactivates them, with audit records', async () => {
    const investor = await createClient(app);
    const { email, userId } = await registerVerified(investor);
    await login(investor, email).expect(200);

    await admin.client.post(`/api/v1/admin/users/${userId}/suspend`).send({ reason: 'Suspicious activity review' }).expect(200);
    await investor.get('/api/v1/users/me').expect(401);
    expect(await lastMessage(email, 'account-suspended')).not.toBeNull();
    await admin.client.post(`/api/v1/admin/users/${userId}/reactivate`).expect(200);
    await login(investor, email).expect(200);

    const actions = (await prisma.auditLog.findMany({ where: { entityId: userId, actorId: admin.userId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.user_suspended', 'admin.user_reactivated']));
  });

  it('revokes all sessions of a user', async () => {
    const investor = await createClient(app);
    const { email, userId } = await registerVerified(investor);
    await login(investor, email).expect(200);
    const res = await admin.client.post(`/api/v1/admin/users/${userId}/sessions/revoke`).expect(200);
    expect(res.body.data.revoked).toBe(1);
    await investor.get('/api/v1/users/me').expect(401);
  });
});

describe('role administration', () => {
  it('creates, edits and deletes custom roles', async () => {
    const created = await admin.client
      .post('/api/v1/admin/roles')
      .send({ key: `REPORT_VIEWER_${RUN}`, name: 'Report viewer', permissions: ['admin:dashboard', 'reports:read'] })
      .expect(201);
    expect(created.body.data).toMatchObject({
      key: `REPORT_VIEWER_${RUN}`,
      isSystem: false,
      permissions: ['admin:dashboard', 'reports:read'],
    });

    const updated = await admin.client
      .patch(`/api/v1/admin/roles/REPORT_VIEWER_${RUN}`)
      .send({ permissions: ['admin:dashboard', 'reports:read', 'audit:read'] })
      .expect(200);
    expect(updated.body.data.permissions).toContain('audit:read');

    await admin.client.delete(`/api/v1/admin/roles/REPORT_VIEWER_${RUN}`).expect(204);
    await admin.client.delete(`/api/v1/admin/roles/REPORT_VIEWER_${RUN}`).expect(404);
  });

  it('rejects edits to system roles, conflicting sets, unknown and investor permissions', async () => {
    await admin.client.patch('/api/v1/admin/roles/AUDITOR').send({ name: 'Renamed' }).expect(409);
    await admin.client.delete('/api/v1/admin/roles/AUDITOR').expect(409);
    await admin.client
      .post('/api/v1/admin/roles')
      .send({ key: `BAD_ROLE_${RUN}`, name: 'Bad', permissions: ['ledger:adjustment:initiate', 'ledger:adjustment:approve'] })
      .expect(409);
    await admin.client
      .post('/api/v1/admin/roles')
      .send({ key: `BAD_ROLE_${RUN}`, name: 'Bad', permissions: ['nope:nope'] })
      .expect(422);
    await admin.client
      .post('/api/v1/admin/roles')
      .send({ key: `BAD_ROLE_${RUN}`, name: 'Bad', permissions: ['wallet:read:own'] })
      .expect(400);
  });

  it('cannot delete a role that is in use', async () => {
    await admin.client
      .post('/api/v1/admin/roles')
      .send({ key: `IN_USE_ROLE_${RUN}`, name: 'In use', permissions: ['reports:read'] })
      .expect(201);
    const staff = await createStaffClient(['AUDITOR'], app);
    await admin.client
      .post(`/api/v1/admin/users/${staff.userId}/roles`)
      .send({ roleKey: `IN_USE_ROLE_${RUN}` })
      .expect(200);
    const res = await admin.client.delete(`/api/v1/admin/roles/IN_USE_ROLE_${RUN}`).expect(409);
    expect(res.body.error.code).toBe('ROLE_IN_USE');
  });

  it('lists the permission catalogue', async () => {
    const res = await admin.client.get('/api/v1/admin/permissions').expect(200);
    expect(res.body.data.find((p) => p.key === 'withdrawals:approve')).toMatchObject({ staff: true });
    expect(res.body.data.find((p) => p.key === 'wallet:read:own')).toMatchObject({ staff: false });
  });
});
