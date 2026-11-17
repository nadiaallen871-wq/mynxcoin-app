import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { prisma } from '../src/db/prisma.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { totp } from '../src/utils/totp.js';
import { buildTestApp } from './helpers.js';

export const PASSWORD = 'correct horse battery staple';
export const uniqueEmail = (tag = 'user') => `${tag}-${randomUUID().slice(0, 8)}@example.test`;

/**
 * Cookie-keeping client that fetches a CSRF token first and attaches it to every
 * unsafe request, the way the SPA does.
 */
export async function createClient(app = buildTestApp({ prisma })) {
  const agent = request.agent(app);
  const res = await agent.get('/api/v1/auth/csrf').expect(200);
  const csrf = res.body.data.csrfToken;
  const withCsrf = (method) => (url) => agent[method](url).set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    get: (url) => agent.get(url),
    post: withCsrf('post'),
    patch: withCsrf('patch'),
    put: withCsrf('put'),
    delete: withCsrf('delete'),
  };
}

/** Most recent outbox message for a recipient and template. */
export async function lastMessage(recipient, template) {
  return prisma.outboundMessage.findFirst({ where: { recipient, template }, orderBy: { createdAt: 'desc' } });
}

export function tokenFromMessage(message) {
  const match = /#token=([^\s]+)/.exec(message?.body ?? '');
  if (!match) throw new Error(`No token link in message: ${message?.template}`);
  return decodeURIComponent(match[1]);
}

/** Registers through the API and confirms the email. Returns { email, userId }. */
export async function registerVerified(client, overrides = {}) {
  const email = overrides.email ?? uniqueEmail();
  await client
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, firstName: 'Ama', lastName: 'Mensah', acceptTerms: true, ...overrides })
    .expect(202);
  const token = tokenFromMessage(await lastMessage(email, 'verify-email'));
  await client.post('/api/v1/auth/verify-email').send({ token }).expect(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { email, userId: user.id };
}

export function login(client, email, password = PASSWORD) {
  return client.post('/api/v1/auth/login').send({ email, password });
}

/** Enables MFA for the client's signed-in user. Returns { secret, recoveryCodes }. */
export async function enableMfa(client, password = PASSWORD) {
  const setup = await client.post('/api/v1/auth/mfa/setup').send({ password }).expect(200);
  const { secret } = setup.body.data;
  const enabled = await client
    .post('/api/v1/auth/mfa/enable')
    .send({ code: totp(secret) })
    .expect(200);
  return { secret, recoveryCodes: enabled.body.data.recoveryCodes };
}

/** Code for the next TOTP step, which avoids the replay guard when a step was just used. */
export const nextCode = (secret) => totp(secret, Date.now() + 30_000);

/**
 * Creates an ACTIVE staff account directly, signs in and enrols MFA.
 * Returns a client with a fully verified staff session.
 */
export async function createStaffClient(roleKeys, app) {
  const email = uniqueEmail('staff');
  const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } } });
  const user = await prisma.user.create({
    data: {
      email,
      type: 'STAFF',
      status: 'ACTIVE',
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
      profile: { create: { firstName: 'Staff', lastName: roleKeys.join(' ') } },
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
  const client = await createClient(app);
  await login(client, email).expect(200);
  const mfa = await enableMfa(client);
  return { client, email, userId: user.id, ...mfa };
}
