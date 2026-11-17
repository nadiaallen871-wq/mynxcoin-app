import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { totp } from '../../src/utils/totp.js';
import { buildTestApp } from '../helpers.js';
import { PASSWORD, createClient, enableMfa, lastMessage, login, nextCode, registerVerified } from '../auth-helpers.js';

let app;
beforeAll(async () => {
  await seed(prisma);
  app = buildTestApp({ prisma });
});
afterAll(() => prisma.$disconnect());

async function signedInUser() {
  const client = await createClient(app);
  const { email, userId } = await registerVerified(client);
  await login(client, email).expect(200);
  return { client, email, userId };
}

describe('MFA enrolment', () => {
  it('requires the password to start, encrypts the secret, and returns recovery codes once', async () => {
    const { client, userId, email } = await signedInUser();
    await client.post('/api/v1/auth/mfa/setup').send({ password: 'wrong password!!' }).expect(422);

    const setup = await client.post('/api/v1/auth/mfa/setup').send({ password: PASSWORD }).expect(200);
    const { secret, otpauthUrl } = setup.body.data;
    expect(otpauthUrl).toContain(`secret=${secret}`);
    const config = await prisma.mfaConfiguration.findUnique({ where: { userId } });
    expect(config.secretEncrypted).not.toContain(secret);
    expect(config.enabledAt).toBeNull();

    await client.post('/api/v1/auth/mfa/enable').send({ code: '000000' }).expect(401);
    const enabled = await client
      .post('/api/v1/auth/mfa/enable')
      .send({ code: totp(secret) })
      .expect(200);
    expect(enabled.body.data.recoveryCodes).toHaveLength(10);
    expect(enabled.body.data.recoveryCodes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(await prisma.recoveryCode.count({ where: { userId } })).toBe(10);
    expect(await lastMessage(email, 'mfa-enabled')).not.toBeNull();

    const status = await client.get('/api/v1/auth/mfa').expect(200);
    expect(status.body.data).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
    await client.post('/api/v1/auth/mfa/setup').send({ password: PASSWORD }).expect(409);
  });
});

describe('MFA sign-in challenge', () => {
  it('holds the session in a pending state until a valid code is given', async () => {
    const { client, email } = await signedInUser();
    const { secret } = await enableMfa(client);
    await client.post('/api/v1/auth/logout').expect(204);

    const res = await login(client, email).expect(200);
    expect(res.body.data.mfaRequired).toBe(true);

    const me = await client.get('/api/v1/users/me').expect(200);
    expect(me.body.data.session.mfaPending).toBe(true);
    expect(me.body.data.permissions).toEqual([]);
    const blocked = await client.patch('/api/v1/users/me').send({ firstName: 'X' }).expect(401);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');

    await client.post('/api/v1/auth/mfa/verify').send({ code: '123456' }).expect(401);
    await client
      .post('/api/v1/auth/mfa/verify')
      .send({ code: nextCode(secret) })
      .expect(200);
    await client.patch('/api/v1/users/me').send({ firstName: 'Yaw' }).expect(200);
  });

  it('rejects replay of the same TOTP code', async () => {
    const { client, email } = await signedInUser();
    const { secret } = await enableMfa(client);
    await client.post('/api/v1/auth/logout').expect(204);
    await login(client, email).expect(200);
    const code = nextCode(secret);
    await client.post('/api/v1/auth/mfa/verify').send({ code }).expect(200);

    const other = await createClient(app);
    await login(other, email).expect(200);
    await other.post('/api/v1/auth/mfa/verify').send({ code }).expect(401);
  });

  it('accepts each recovery code once and notifies the user', async () => {
    const { client, email } = await signedInUser();
    const { recoveryCodes } = await enableMfa(client);
    await client.post('/api/v1/auth/logout').expect(204);

    await login(client, email).expect(200);
    await client.post('/api/v1/auth/mfa/verify').send({ recoveryCode: recoveryCodes[0].toLowerCase() }).expect(200);
    expect((await lastMessage(email, 'recovery-code-used')).body).toContain('9 unused');

    const other = await createClient(app);
    await login(other, email).expect(200);
    await other.post('/api/v1/auth/mfa/verify').send({ recoveryCode: recoveryCodes[0] }).expect(401);
  });

  it('revokes the pending session after five wrong codes', async () => {
    const { client, email } = await signedInUser();
    await enableMfa(client);
    await client.post('/api/v1/auth/logout').expect(204);
    await login(client, email).expect(200);
    for (let i = 0; i < 4; i++) await client.post('/api/v1/auth/mfa/verify').send({ code: '000001' }).expect(401);
    const locked = await client.post('/api/v1/auth/mfa/verify').send({ code: '000001' }).expect(401);
    expect(locked.body.error.code).toBe('MFA_LOCKED');
    await client.get('/api/v1/users/me').expect(401);
  });

  it('rejects a challenge when none is pending', async () => {
    const { client } = await signedInUser();
    const res = await client.post('/api/v1/auth/mfa/verify').send({ code: '123456' }).expect(409);
    expect(res.body.error.code).toBe('MFA_NOT_PENDING');
  });
});

describe('MFA management (step-up)', () => {
  it('regenerates recovery codes and disables MFA only with password and code', async () => {
    const { client, userId, email } = await signedInUser();
    const { secret, recoveryCodes } = await enableMfa(client);

    await client.post('/api/v1/auth/mfa/recovery-codes').send({ password: PASSWORD, code: '000000' }).expect(401);
    const regen = await client
      .post('/api/v1/auth/mfa/recovery-codes')
      .send({ password: PASSWORD, code: nextCode(secret) })
      .expect(200);
    expect(regen.body.data.recoveryCodes).toHaveLength(10);
    expect(regen.body.data.recoveryCodes).not.toContain(recoveryCodes[0]);

    await client
      .post('/api/v1/auth/mfa/disable')
      .send({ password: 'not my password', recoveryCode: regen.body.data.recoveryCodes[0] })
      .expect(422);
    await client.post('/api/v1/auth/mfa/disable').send({ password: PASSWORD, recoveryCode: regen.body.data.recoveryCodes[0] }).expect(200);
    expect(await prisma.mfaConfiguration.findUnique({ where: { userId } })).toBeNull();
    expect(await prisma.recoveryCode.count({ where: { userId } })).toBe(0);
    expect(await lastMessage(email, 'mfa-disabled')).not.toBeNull();
  });
});
