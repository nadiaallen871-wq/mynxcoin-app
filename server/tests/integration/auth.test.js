import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers.js';
import { PASSWORD, createClient, lastMessage, login, registerVerified, tokenFromMessage, uniqueEmail } from '../auth-helpers.js';

let app;
beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
});
afterAll(() => prisma.$disconnect());

describe('CSRF protection', () => {
  it('rejects state-changing requests without a matching token', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.test', password: 'x' }).expect(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');

    const client = await createClient(app);
    const wrong = await client.agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'x'.repeat(43))
      .send({ email: 'a@b.test', password: 'x' });
    expect(wrong.status).toBe(403);
  });

  it('sets the CSRF cookie httpOnly and SameSite=Lax', async () => {
    const res = await request(app).get('/api/v1/auth/csrf').expect(200);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('mynx_csrf='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });
});

describe('registration and email verification', () => {
  it('creates a pending investor with profile and role, and sends a verification link', async () => {
    const client = await createClient(app);
    const email = uniqueEmail();
    await client
      .post('/api/v1/auth/register')
      .send({ email: email.toUpperCase(), password: PASSWORD, firstName: 'Kofi', lastName: 'Boateng', acceptTerms: true })
      .expect(202);

    const user = await prisma.user.findUnique({ where: { email }, include: { profile: true, roles: { include: { role: true } } } });
    expect(user.status).toBe('PENDING_VERIFICATION');
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.profile).toMatchObject({ firstName: 'Kofi', country: 'GH' });
    expect(user.roles.map((r) => r.role.key)).toEqual(['INDIVIDUAL_INVESTOR']);

    const message = await lastMessage(email, 'verify-email');
    expect(message.status).toBe('SENT');
    const token = tokenFromMessage(message);
    expect(await prisma.verificationToken.findFirst({ where: { tokenHash: token } })).toBeNull(); // only the HMAC is stored

    const blocked = await login(client, email);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    await client.post('/api/v1/auth/verify-email').send({ token }).expect(200);
    expect((await prisma.user.findUnique({ where: { email } })).status).toBe('ACTIVE');

    const reused = await client.post('/api/v1/auth/verify-email').send({ token }).expect(400);
    expect(reused.body.error.code).toBe('TOKEN_INVALID');
  });

  it('assigns the institutional role and requires an organisation name', async () => {
    const client = await createClient(app);
    const email = uniqueEmail('org');
    const missing = await client
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, firstName: 'A', lastName: 'B', accountType: 'INSTITUTIONAL', acceptTerms: true });
    expect(missing.status).toBe(422);
    await client
      .post('/api/v1/auth/register')
      .send({
        email,
        password: PASSWORD,
        firstName: 'A',
        lastName: 'B',
        accountType: 'INSTITUTIONAL',
        organizationName: 'Acme Pensions Ltd',
        acceptTerms: true,
      })
      .expect(202);
    const user = await prisma.user.findUnique({ where: { email }, include: { roles: { include: { role: true } } } });
    expect(user.type).toBe('INSTITUTIONAL');
    expect(user.roles[0].role.key).toBe('INSTITUTIONAL_INVESTOR');
  });

  it('enforces the password policy and terms acceptance', async () => {
    const client = await createClient(app);
    const weak = await client
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: 'password1234', firstName: 'A', lastName: 'B', acceptTerms: true });
    expect(weak.status).toBe(422);
    expect(weak.body.error.details[0]).toMatchObject({ path: 'password' });
    const noTerms = await client
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD, firstName: 'A', lastName: 'B' });
    expect(noTerms.status).toBe(422);
  });

  it('does not reveal whether an email is registered', async () => {
    const client = await createClient(app);
    const { email } = await registerVerified(client);
    const again = await client
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, firstName: 'X', lastName: 'Y', acceptTerms: true });
    expect(again.status).toBe(202);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await lastMessage(email, 'already-registered')).not.toBeNull();

    const fresh = await client.post('/api/v1/auth/forgot-password').send({ email: uniqueEmail('nobody') });
    const known = await client.post('/api/v1/auth/forgot-password').send({ email });
    expect(fresh.status).toBe(known.status);
    expect(fresh.body).toEqual(known.body);
  });
});

describe('login, sessions and logout', () => {
  it('issues an httpOnly session cookie, stores only its hash, and logs out', async () => {
    const client = await createClient(app);
    const { email, userId } = await registerVerified(client);
    const res = await login(client, email).expect(200);
    expect(res.body.data.mfaRequired).toBe(false);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('mynx_sid='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const raw = /mynx_sid=([^;]+)/.exec(cookie)[1];
    expect(await prisma.userSession.findFirst({ where: { tokenHash: raw } })).toBeNull();

    const me = await client.get('/api/v1/users/me').expect(200);
    expect(me.body.data.user).toMatchObject({ id: userId, email, emailVerified: true });
    expect(me.body.data.permissions).toContain('profile:read:own');
    expect(me.body.data.permissions).not.toContain('users:read:any');

    expect((await client.get('/api/v1/users/session').expect(200)).body.data.user.id).toBe(userId);
    await client.post('/api/v1/auth/logout').expect(204);
    await client.get('/api/v1/users/me').expect(401);
    expect((await client.get('/api/v1/users/session').expect(200)).body.data).toBeNull();
    const session = await prisma.userSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    expect(session.revokedReason).toBe('logout');
  });

  it('gives the same error for unknown emails and wrong passwords', async () => {
    const client = await createClient(app);
    const { email } = await registerVerified(client);
    const unknown = await login(client, uniqueEmail('ghost')).expect(401);
    const wrong = await login(client, email, 'not the right password').expect(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('locks the account after repeated failures, emails the owner, and rejects even the right password while locked', async () => {
    const client = await createClient(app);
    const { email, userId } = await registerVerified(client);
    for (let i = 0; i < 5; i++) await login(client, email, `wrong password ${i}`).expect(401);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    expect(await lastMessage(email, 'account-locked')).not.toBeNull();
    await login(client, email).expect(401);

    await prisma.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await login(client, email).expect(200);
    expect((await prisma.user.findUnique({ where: { id: userId } })).failedLoginCount).toBe(0);
  });

  it('records sign-in attempts and alerts on a new device after the first login', async () => {
    const client = await createClient(app);
    const { email, userId } = await registerVerified(client);
    await login(client, email).expect(200);
    expect(await lastMessage(email, 'login-alert')).toBeNull();

    const other = await createClient(app);
    await other.post('/api/v1/auth/login').set('User-Agent', 'NewPhone/1.0').send({ email, password: PASSWORD }).expect(200);
    expect(await lastMessage(email, 'login-alert')).not.toBeNull();

    const history = await other.get('/api/v1/users/me/login-history').expect(200);
    expect(history.body.data.filter((h) => h.success)).toHaveLength(2);
    expect(await prisma.loginAttempt.count({ where: { userId, success: true } })).toBe(2);
  });

  it('expires idle sessions and sessions past their absolute lifetime', async () => {
    const client = await createClient(app);
    const { email, userId } = await registerVerified(client);
    await login(client, email).expect(200);
    const session = await prisma.userSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });

    await prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    await client.get('/api/v1/users/me').expect(401);

    await prisma.userSession.update({
      where: { id: session.id },
      data: { createdAt: new Date(Date.now() - 13 * 3_600_000), lastSeenAt: new Date(), absoluteExpiresAt: new Date(Date.now() - 1000) },
    });
    await client.get('/api/v1/users/me').expect(401);
  });

  it('lists sessions and revokes another device', async () => {
    const a = await createClient(app);
    const { email } = await registerVerified(a);
    await login(a, email).expect(200);
    const b = await createClient(app);
    await login(b, email).expect(200);

    const list = await a.get('/api/v1/users/me/sessions').expect(200);
    expect(list.body.data).toHaveLength(2);
    const otherSession = list.body.data.find((s) => !s.current);
    await a.delete(`/api/v1/users/me/sessions/${otherSession.id}`).expect(200);
    await b.get('/api/v1/users/me').expect(401);
    await a.get('/api/v1/users/me').expect(200);
  });

  it('suspended users are signed out and cannot sign in', async () => {
    const client = await createClient(app);
    const { email, userId } = await registerVerified(client);
    await login(client, email).expect(200);
    await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
    await client.get('/api/v1/users/me').expect(401);
    const res = await login(client, email).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('password recovery and change', () => {
  it('resets the password with a single-use link and signs out every session', async () => {
    const a = await createClient(app);
    const { email } = await registerVerified(a);
    await login(a, email).expect(200);

    await a.post('/api/v1/auth/forgot-password').send({ email }).expect(202);
    const token = tokenFromMessage(await lastMessage(email, 'password-reset'));
    const b = await createClient(app);
    const weak = await b.post('/api/v1/auth/reset-password').send({ token, password: 'short' });
    expect(weak.status).toBe(422);
    await b.post('/api/v1/auth/reset-password').send({ token, password: 'a brand new passphrase 2026' }).expect(200);

    await a.get('/api/v1/users/me').expect(401);
    await login(b, email).expect(401);
    await login(b, email, 'a brand new passphrase 2026').expect(200);
    await b.post('/api/v1/auth/reset-password').send({ token, password: 'yet another passphrase 99' }).expect(400);
    expect(await lastMessage(email, 'password-changed')).not.toBeNull();
  });

  it('only the latest reset link works, and expired links are rejected', async () => {
    const client = await createClient(app);
    const { email, userId } = await registerVerified(client);
    await client.post('/api/v1/auth/forgot-password').send({ email }).expect(202);
    const first = tokenFromMessage(await lastMessage(email, 'password-reset'));
    await prisma.verificationToken.updateMany({
      where: { userId, type: 'PASSWORD_RESET' },
      data: { createdAt: new Date(Date.now() - 60 * 60_000) },
    });
    await client.post('/api/v1/auth/forgot-password').send({ email }).expect(202);
    const second = tokenFromMessage(await lastMessage(email, 'password-reset'));
    await client.post('/api/v1/auth/reset-password').send({ token: first, password: 'a brand new passphrase 2026' }).expect(400);

    await prisma.verificationToken.updateMany({
      where: { userId, type: 'PASSWORD_RESET', consumedAt: null },
      data: { createdAt: new Date(Date.now() - 2 * 3_600_000), expiresAt: new Date(Date.now() - 1000) },
    });
    await client.post('/api/v1/auth/reset-password').send({ token: second, password: 'a brand new passphrase 2026' }).expect(400);
  });

  it('changes the password, keeps the current session and signs out the others', async () => {
    const a = await createClient(app);
    const { email } = await registerVerified(a);
    await login(a, email).expect(200);
    const b = await createClient(app);
    await login(b, email).expect(200);

    const bad = await a
      .post('/api/v1/auth/password')
      .send({ currentPassword: 'wrong one entirely', newPassword: 'another long passphrase' });
    expect(bad.status).toBe(422);
    await a.post('/api/v1/auth/password').send({ currentPassword: PASSWORD, newPassword: 'another long passphrase' }).expect(200);
    await a.get('/api/v1/users/me').expect(200);
    await b.get('/api/v1/users/me').expect(401);
  });
});

describe('profile and phone verification', () => {
  it('updates the profile with an audit record', async () => {
    const client = await createClient(app);
    const { email, userId } = await registerVerified(client);
    await login(client, email).expect(200);
    const res = await client.patch('/api/v1/users/me').send({ firstName: 'Abena' }).expect(200);
    expect(res.body.data.firstName).toBe('Abena');
    await client.patch('/api/v1/users/me').send({ email: 'evil@x.test' }).expect(422);
    await client.patch('/api/v1/users/me').send({ organizationName: 'Not allowed' }).expect(400);
    const log = await prisma.auditLog.findFirst({ where: { entityId: userId, action: 'user.profile_updated' } });
    expect(log.before.firstName).toBe('Ama');
  });

  it('verifies a phone number with a 6-digit SMS code and limits attempts', async () => {
    const client = await createClient(app);
    const { email, userId } = await registerVerified(client);
    await login(client, email).expect(200);
    const phone = `+23324${String(Date.now()).slice(-7)}`;
    const start = await client
      .post('/api/v1/users/me/phone')
      .send({ phone: `0${phone.slice(4)}` })
      .expect(202);
    expect(start.body.data.phone).toBe(phone);
    const sms = await lastMessage(phone, 'phone-code');
    expect(sms.channel).toBe('SMS');
    const code = /code is (\d{6})/.exec(sms.body)[1];

    const wrong = code === '000000' ? '111111' : '000000';
    await client.post('/api/v1/users/me/phone/verify').send({ code: wrong }).expect(400);
    await client.post('/api/v1/users/me/phone/verify').send({ code }).expect(200);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.phone).toBe(phone);
    expect(user.phoneVerifiedAt).not.toBeNull();

    const cooldown = await client.post('/api/v1/users/me/phone').send({ phone });
    expect(cooldown.status).toBe(429);
  });
});

describe('auth rate limiting', () => {
  it('limits credential endpoints per IP', async () => {
    const limited = buildTestApp({ prisma, env: { AUTH_RATE_LIMIT_MAX: '3' } });
    const client = await createClient(limited);
    for (let i = 0; i < 3; i++) await login(client, uniqueEmail('rl')).expect(401);
    const res = await login(client, uniqueEmail('rl')).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('audit trail', () => {
  it('records registration, verification and login', async () => {
    const client = await createClient(app);
    const { email, userId } = await registerVerified(client);
    await login(client, email).expect(200);
    const actions = (await prisma.auditLog.findMany({ where: { actorId: userId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.register', 'auth.email_verified', 'auth.login']));
  });
});
