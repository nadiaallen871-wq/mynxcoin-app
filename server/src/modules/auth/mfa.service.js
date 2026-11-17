import { createCipher, hmacSha256 } from '../../utils/crypto.js';
import { base32Encode, generateTotpSecret, otpauthUrl, verifyTotp } from '../../utils/totp.js';
import { AppError, ConflictError, ValidationError } from '../../utils/errors.js';
import { verifyPassword } from './password.js';
import { randomBytes } from 'node:crypto';

const RECOVERY_CODE_COUNT = 10;
const MAX_CHALLENGE_FAILURES = 5;

const normalizeRecovery = (code) =>
  String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');

const mfaInvalid = () => new AppError('That code is not valid. Try again.', { status: 401, code: 'MFA_INVALID' });

/**
 * TOTP two-factor authentication with single-use recovery codes.
 * - Secrets are encrypted at rest (AES-256-GCM).
 * - Each TOTP time-step can be used only once (replay protection).
 * - Enrolment, disabling and code regeneration require the password and a valid code (step-up).
 * - Five failed challenges revoke the pending session.
 */
export function createMfaService({ prisma, env, sessions, messaging, audit }) {
  const cipher = createCipher(env.ENCRYPTION_KEY);
  const hashRecovery = (userId, code) => hmacSha256(env.SESSION_SECRET, `recovery:${userId}:${normalizeRecovery(code)}`);
  const firstNameOf = async (userId, tx) => (await tx.userProfile.findUnique({ where: { userId } }))?.firstName ?? 'there';

  function newRecoveryCodes() {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = base32Encode(randomBytes(7)).slice(0, 10);
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
  }

  async function replaceRecoveryCodes(tx, userId) {
    const codes = newRecoveryCodes();
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashRecovery(userId, code) })) });
    return codes;
  }

  /** Consumes a TOTP step atomically. Returns true on success. */
  async function useTotp(tx, config, code) {
    const secret = cipher.decrypt(config.secretEncrypted);
    const afterStep = config.lastUsedStep === null ? null : Number(config.lastUsedStep);
    const step = verifyTotp(secret, code, { afterStep });
    if (step === null) return false;
    const { count } = await tx.mfaConfiguration.updateMany({
      where: { userId: config.userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }] },
      data: { lastUsedStep: BigInt(step) },
    });
    return count === 1;
  }

  async function useRecoveryCode(tx, userId, code) {
    const { count } = await tx.recoveryCode.updateMany({
      where: { userId, codeHash: hashRecovery(userId, code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  async function stepUp(tx, userId, { password, code, recoveryCode }) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { mfa: true } });
    if (!user.mfa?.enabledAt) throw new ConflictError('Two-factor authentication is not enabled', 'MFA_NOT_ENABLED');
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new ValidationError([{ location: 'body', path: 'password', message: 'Password is incorrect', code: 'invalid_password' }]);
    }
    const ok = code ? await useTotp(tx, user.mfa, code) : recoveryCode ? await useRecoveryCode(tx, userId, recoveryCode) : false;
    if (!ok) throw mfaInvalid();
    return user;
  }

  return {
    async status(userId) {
      const config = await prisma.mfaConfiguration.findUnique({ where: { userId } });
      const remaining = config?.enabledAt ? await prisma.recoveryCode.count({ where: { userId, usedAt: null } }) : 0;
      return { enabled: Boolean(config?.enabledAt), enabledAt: config?.enabledAt ?? null, recoveryCodesRemaining: remaining };
    },

    /** Starts enrolment. Returns the secret for the authenticator app. It is not active until confirmed. */
    async setup(auth, { password }) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, include: { mfa: true } });
      if (user.mfa?.enabledAt) throw new ConflictError('Two-factor authentication is already enabled', 'MFA_ALREADY_ENABLED');
      if (!(await verifyPassword(user.passwordHash, password))) {
        throw new ValidationError([{ location: 'body', path: 'password', message: 'Password is incorrect', code: 'invalid_password' }]);
      }
      const secret = generateTotpSecret();
      const secretEncrypted = cipher.encrypt(secret);
      await prisma.mfaConfiguration.upsert({
        where: { userId: user.id },
        create: { userId: user.id, secretEncrypted },
        update: { secretEncrypted, enabledAt: null, lastUsedStep: null },
      });
      return { secret, otpauthUrl: otpauthUrl({ secret, accountName: user.email, issuer: env.MFA_ISSUER }) };
    },

    /** Confirms enrolment with a first code and returns the recovery codes (shown once). */
    async enable(auth, { code }, ctx) {
      const { codes, message } = await prisma.$transaction(async (tx) => {
        const config = await tx.mfaConfiguration.findUnique({ where: { userId: auth.user.id } });
        if (!config) throw new ConflictError('Start two-factor setup first', 'MFA_SETUP_REQUIRED');
        if (config.enabledAt) throw new ConflictError('Two-factor authentication is already enabled', 'MFA_ALREADY_ENABLED');
        if (!(await useTotp(tx, config, code))) throw mfaInvalid();
        await tx.mfaConfiguration.update({ where: { userId: auth.user.id }, data: { enabledAt: new Date() } });
        const recoveryCodes = await replaceRecoveryCodes(tx, auth.user.id);
        await tx.userSession.update({ where: { id: auth.session.id }, data: { mfaRequired: true, mfaVerifiedAt: new Date() } });
        await audit.record({ actorId: auth.user.id, action: 'auth.mfa_enabled', entityType: 'user', entityId: auth.user.id, ...ctx }, tx);
        const msg = await messaging.queue(tx, {
          userId: auth.user.id,
          recipient: auth.user.email,
          template: 'mfa-enabled',
          vars: { firstName: await firstNameOf(auth.user.id, tx) },
        });
        return { codes: recoveryCodes, message: msg };
      });
      await messaging.dispatch([message]);
      return { recoveryCodes: codes };
    },

    /** Completes sign-in for an MFA-pending session. */
    async verifyChallenge(auth, { code, recoveryCode }, ctx) {
      if (!auth.mfaPending) throw new ConflictError('No two-factor challenge is pending for this session', 'MFA_NOT_PENDING');

      const outcome = await prisma.$transaction(async (tx) => {
        const config = await tx.mfaConfiguration.findUnique({ where: { userId: auth.user.id } });
        let method = null;
        if (config?.enabledAt && code && (await useTotp(tx, config, code))) method = 'totp';
        else if (config?.enabledAt && recoveryCode && (await useRecoveryCode(tx, auth.user.id, recoveryCode))) method = 'recovery_code';

        if (!method) {
          const session = await tx.userSession.update({ where: { id: auth.session.id }, data: { mfaFailedAttempts: { increment: 1 } } });
          await tx.loginAttempt.create({
            data: {
              email: auth.user.email,
              userId: auth.user.id,
              ipAddress: ctx.ip,
              userAgent: ctx.userAgent?.slice(0, 512) ?? null,
              success: false,
              reason: 'MFA_FAILED',
            },
          });
          if (session.mfaFailedAttempts >= MAX_CHALLENGE_FAILURES) {
            await sessions.revoke(auth.session.id, 'mfa_failed', tx);
            await audit.record(
              { actorId: auth.user.id, action: 'auth.mfa_challenge_locked', entityType: 'session', entityId: auth.session.id, ...ctx },
              tx,
            );
            return { failed: true, revoked: true };
          }
          return { failed: true };
        }

        await tx.userSession.update({ where: { id: auth.session.id }, data: { mfaVerifiedAt: new Date() } });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'auth.mfa_verified',
            entityType: 'session',
            entityId: auth.session.id,
            metadata: { method },
            ...ctx,
          },
          tx,
        );
        if (method !== 'recovery_code') return { method };
        const remaining = await tx.recoveryCode.count({ where: { userId: auth.user.id, usedAt: null } });
        const msg = await messaging.queue(tx, {
          userId: auth.user.id,
          recipient: auth.user.email,
          template: 'recovery-code-used',
          vars: { firstName: await firstNameOf(auth.user.id, tx), remaining },
        });
        return { method, message: msg };
      });

      if (outcome.revoked) throw new AppError('Too many incorrect codes. Sign in again.', { status: 401, code: 'MFA_LOCKED' });
      if (outcome.failed) throw mfaInvalid();
      await messaging.dispatch([outcome.message]);
      return { method: outcome.method };
    },

    async disable(auth, input, ctx) {
      const message = await prisma.$transaction(async (tx) => {
        await stepUp(tx, auth.user.id, input);
        await tx.recoveryCode.deleteMany({ where: { userId: auth.user.id } });
        await tx.mfaConfiguration.delete({ where: { userId: auth.user.id } });
        await tx.userSession.updateMany({ where: { userId: auth.user.id, revokedAt: null }, data: { mfaRequired: false } });
        await audit.record({ actorId: auth.user.id, action: 'auth.mfa_disabled', entityType: 'user', entityId: auth.user.id, ...ctx }, tx);
        return messaging.queue(tx, {
          userId: auth.user.id,
          recipient: auth.user.email,
          template: 'mfa-disabled',
          vars: { firstName: await firstNameOf(auth.user.id, tx) },
        });
      });
      await messaging.dispatch([message]);
    },

    async regenerateRecoveryCodes(auth, input, ctx) {
      const { codes, message } = await prisma.$transaction(async (tx) => {
        await stepUp(tx, auth.user.id, input);
        const recoveryCodes = await replaceRecoveryCodes(tx, auth.user.id);
        await audit.record(
          { actorId: auth.user.id, action: 'auth.recovery_codes_regenerated', entityType: 'user', entityId: auth.user.id, ...ctx },
          tx,
        );
        const msg = await messaging.queue(tx, {
          userId: auth.user.id,
          recipient: auth.user.email,
          template: 'recovery-codes-regenerated',
          vars: { firstName: await firstNameOf(auth.user.id, tx) },
        });
        return { codes: recoveryCodes, message: msg };
      });
      await messaging.dispatch([message]);
      return { recoveryCodes: codes };
    },
  };
}
