import { AppError, BadRequestError, ValidationError } from '../../utils/errors.js';
import { burnPasswordCheck, checkPasswordPolicy, hashPassword, needsRehash, verifyPassword } from './password.js';

const INVESTOR_ROLE = { INDIVIDUAL: 'INDIVIDUAL_INVESTOR', INSTITUTIONAL: 'INSTITUTIONAL_INVESTOR' };
const NEW_DEVICE_LOOKBACK_MS = 90 * 24 * 3_600_000;
const RESEND_COOLDOWN_MS = 60_000;

export const invalidCredentials = () =>
  new AppError('Incorrect email or password. Repeated failures temporarily lock the account. Check your email if this happens.', {
    status: 401,
    code: 'INVALID_CREDENTIALS',
  });

const tokenInvalid = () => new BadRequestError('This link is invalid or has expired. Request a new one.', 'TOKEN_INVALID');

/**
 * Registration, email verification, login, logout and password recovery.
 *
 * Anti-enumeration: register, resend-verification and forgot-password return the
 * same response whether or not the email exists, and login takes the same time
 * and gives the same error for unknown emails, wrong passwords and locked accounts.
 */
export function createAuthService({
  prisma,
  env,
  sessions,
  tokens,
  messaging,
  audit,
  users,
  onRegistered = null,
  onLoginSucceeded = null,
}) {
  const firstNameOf = async (userId, tx = prisma) =>
    (await tx.userProfile.findUnique({ where: { userId }, select: { firstName: true } }))?.firstName ?? 'there';

  async function recordAttempt(tx, { email, userId = null, ctx, success, reason }) {
    await tx.loginAttempt.create({
      data: { email: email.slice(0, 320), userId, ipAddress: ctx.ip, userAgent: ctx.userAgent?.slice(0, 512) ?? null, success, reason },
    });
  }

  function assertPolicy(password, email, field = 'password') {
    const problem = checkPasswordPolicy(password, { email });
    if (problem) throw new ValidationError([{ location: 'body', path: field, message: problem, code: 'password_policy' }]);
  }

  return {
    async register(input, ctx) {
      const email = users.normalizeEmail(input.email);
      assertPolicy(input.password, email);
      const passwordHash = await hashPassword(input.password);

      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        const msg = await prisma.$transaction((tx) =>
          messaging.queue(tx, {
            userId: existing.id,
            recipient: email,
            template: 'already-registered',
            vars: { loginLink: `${env.APP_BASE_URL}/login`, resetLink: `${env.APP_BASE_URL}/forgot-password` },
          }),
        );
        await messaging.dispatch([msg]);
        return;
      }

      let message;
      try {
        message = await prisma.$transaction(async (tx) => {
          const role = await tx.role.findUniqueOrThrow({ where: { key: INVESTOR_ROLE[input.accountType] } });
          const user = await tx.user.create({
            data: {
              email,
              type: input.accountType,
              passwordHash,
              passwordChangedAt: new Date(),
              profile: {
                create: {
                  firstName: input.firstName,
                  lastName: input.lastName,
                  organizationName: input.accountType === 'INSTITUTIONAL' ? input.organizationName : null,
                  country: input.country,
                },
              },
              roles: { create: { roleId: role.id } },
            },
          });
          // Referral attribution is fixed here, in the same transaction as the account.
          if (onRegistered) await onRegistered(tx, { referredUserId: user.id, code: input.referralCode, ip: ctx.ip });
          const { raw } = await tokens.issue(tx, { userId: user.id, type: 'EMAIL_VERIFICATION', target: email });
          await audit.record(
            { actorId: user.id, action: 'auth.register', entityType: 'user', entityId: user.id, after: { email, type: user.type }, ...ctx },
            tx,
          );
          return messaging.queue(tx, {
            userId: user.id,
            recipient: email,
            template: 'verify-email',
            vars: { firstName: input.firstName, link: tokens.link('/verify-email', raw) },
          });
        });
      } catch (err) {
        if (err.code === 'P2002') return; // concurrent registration with the same email: same neutral outcome
        throw err;
      }
      await messaging.dispatch([message]);
    },

    async verifyEmail({ token }, ctx) {
      const row = await tokens.find(token, ['EMAIL_VERIFICATION']);
      if (!row || row.target !== row.user.email) throw tokenInvalid();
      await prisma.$transaction(async (tx) => {
        if (!(await tokens.consume(tx, row.id))) throw tokenInvalid();
        await tx.user.update({
          where: { id: row.userId },
          data: {
            emailVerifiedAt: row.user.emailVerifiedAt ?? new Date(),
            ...(row.user.status === 'PENDING_VERIFICATION' && row.user.passwordHash ? { status: 'ACTIVE' } : {}),
          },
        });
        await audit.record({ actorId: row.userId, action: 'auth.email_verified', entityType: 'user', entityId: row.userId, ...ctx }, tx);
      });
    },

    async resendVerification({ email: rawEmail }) {
      const email = users.normalizeEmail(rawEmail);
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || user.emailVerifiedAt) return;
      const recent = await prisma.verificationToken.findFirst({
        where: { userId: user.id, type: 'EMAIL_VERIFICATION', createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
      });
      if (recent) return;
      const message = await prisma.$transaction(async (tx) => {
        const { raw } = await tokens.issue(tx, { userId: user.id, type: 'EMAIL_VERIFICATION', target: email });
        return messaging.queue(tx, {
          userId: user.id,
          recipient: email,
          template: 'verify-email',
          vars: { firstName: await firstNameOf(user.id, tx), link: tokens.link('/verify-email', raw) },
        });
      });
      await messaging.dispatch([message]);
    },

    /**
     * Returns { token, session, mfaRequired }. When MFA is enabled, the session is
     * created in an MFA-pending state that only the MFA challenge endpoint accepts.
     */
    async login({ email: rawEmail, password }, ctx) {
      const email = users.normalizeEmail(rawEmail);
      const user = await prisma.user.findUnique({ where: { email }, include: { mfa: true } });

      if (!user) {
        await burnPasswordCheck(password);
        await recordAttempt(prisma, { email, ctx, success: false, reason: 'UNKNOWN_EMAIL' });
        throw invalidCredentials();
      }

      const passwordOk = await verifyPassword(user.passwordHash, password);

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        await recordAttempt(prisma, { email, userId: user.id, ctx, success: false, reason: 'LOCKED' });
        throw invalidCredentials();
      }

      if (!passwordOk) {
        const messages = await prisma.$transaction(async (tx) => {
          await recordAttempt(tx, { email, userId: user.id, ctx, success: false, reason: 'BAD_PASSWORD' });
          const updated = await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } } });
          if (updated.failedLoginCount < env.LOCKOUT_THRESHOLD) return [];
          await tx.user.update({
            where: { id: user.id },
            data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + env.LOCKOUT_MINUTES * 60_000) },
          });
          await audit.record(
            { action: 'auth.account_locked', entityType: 'user', entityId: user.id, metadata: { minutes: env.LOCKOUT_MINUTES }, ...ctx },
            tx,
          );
          return [
            await messaging.queue(tx, {
              userId: user.id,
              recipient: user.email,
              template: 'account-locked',
              vars: {
                firstName: await firstNameOf(user.id, tx),
                minutes: env.LOCKOUT_MINUTES,
                resetLink: `${env.APP_BASE_URL}/forgot-password`,
              },
            }),
          ];
        });
        await messaging.dispatch(messages);
        throw invalidCredentials();
      }

      // The password is correct from here on, so specific errors no longer leak account existence.
      if (!['ACTIVE', 'PENDING_VERIFICATION'].includes(user.status)) {
        await recordAttempt(prisma, { email, userId: user.id, ctx, success: false, reason: 'DISABLED' });
        throw new AppError('This account is not active. Contact support for help.', { status: 403, code: 'ACCOUNT_DISABLED' });
      }
      if (!user.emailVerifiedAt || user.status !== 'ACTIVE') {
        await recordAttempt(prisma, { email, userId: user.id, ctx, success: false, reason: 'NOT_VERIFIED' });
        throw new AppError('Confirm your email address before signing in. Check your inbox or request a new link.', {
          status: 403,
          code: 'EMAIL_NOT_VERIFIED',
        });
      }

      const mfaRequired = Boolean(user.mfa?.enabledAt);
      const rehash = needsRehash(user.passwordHash) ? await hashPassword(password) : null;

      const priorLogins = await prisma.loginAttempt.findMany({
        where: { userId: user.id, success: true, createdAt: { gt: new Date(Date.now() - NEW_DEVICE_LOOKBACK_MS) } },
        select: { ipAddress: true, userAgent: true },
        take: 200,
        orderBy: { createdAt: 'desc' },
      });
      const knownDevice = priorLogins.some((p) => p.ipAddress === ctx.ip && p.userAgent === (ctx.userAgent?.slice(0, 512) ?? null));
      const everLoggedIn = Boolean(user.lastLoginAt) || priorLogins.length > 0;

      const { result, messages } = await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), ...(rehash ? { passwordHash: rehash } : {}) },
        });
        const created = await sessions.create(tx, { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, mfaRequired });
        await recordAttempt(tx, { email, userId: user.id, ctx, success: true, reason: mfaRequired ? 'MFA_PENDING' : 'OK' });
        await audit.record(
          {
            actorId: user.id,
            action: 'auth.login',
            entityType: 'session',
            entityId: created.session.id,
            metadata: { mfaRequired, newDevice: !knownDevice },
            ...ctx,
          },
          tx,
        );
        const queued = [];
        if (everLoggedIn && !knownDevice) {
          queued.push(
            await messaging.queue(tx, {
              userId: user.id,
              recipient: user.email,
              template: 'login-alert',
              vars: { firstName: await firstNameOf(user.id, tx), ip: ctx.ip, userAgent: ctx.userAgent, time: new Date().toUTCString() },
            }),
          );
        }
        return { result: { ...created, mfaRequired }, messages: queued };
      });
      await messaging.dispatch(messages);
      // Fraud monitoring (new device after failed attempts). The hook never throws.
      if (onLoginSucceeded) await onLoginSucceeded({ userId: user.id, knownDevice });
      return result;
    },

    async logout(auth, ctx) {
      await sessions.revoke(auth.session.id, 'logout');
      await audit.record({ actorId: auth.user.id, action: 'auth.logout', entityType: 'session', entityId: auth.session.id, ...ctx });
    },

    async forgotPassword({ email: rawEmail }, ctx) {
      const email = users.normalizeEmail(rawEmail);
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !['ACTIVE', 'PENDING_VERIFICATION'].includes(user.status)) return;
      const message = await prisma.$transaction(async (tx) => {
        const { raw } = await tokens.issue(tx, { userId: user.id, type: 'PASSWORD_RESET', target: email });
        await audit.record(
          { actorId: user.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id, ...ctx },
          tx,
        );
        return messaging.queue(tx, {
          userId: user.id,
          recipient: email,
          template: 'password-reset',
          vars: { firstName: await firstNameOf(user.id, tx), link: tokens.link('/reset-password', raw) },
        });
      });
      await messaging.dispatch([message]);
    },

    /** Completes a password reset or a staff account setup. Signs out every session. */
    async resetPassword({ token, password }, ctx) {
      const row = await tokens.find(token, ['PASSWORD_RESET', 'ACCOUNT_SETUP']);
      if (!row || row.target !== row.user.email || !['ACTIVE', 'PENDING_VERIFICATION'].includes(row.user.status)) throw tokenInvalid();
      assertPolicy(password, row.user.email);
      if (row.user.passwordHash && (await verifyPassword(row.user.passwordHash, password))) {
        throw new ValidationError([
          { location: 'body', path: 'password', message: 'Choose a password you have not used for this account', code: 'password_reuse' },
        ]);
      }
      const passwordHash = await hashPassword(password);

      const message = await prisma.$transaction(async (tx) => {
        if (!(await tokens.consume(tx, row.id))) throw tokenInvalid();
        // The token arrived at this inbox, which proves ownership of the email address.
        await tx.user.update({
          where: { id: row.userId },
          data: {
            passwordHash,
            passwordChangedAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
            emailVerifiedAt: row.user.emailVerifiedAt ?? new Date(),
            ...(row.user.status === 'PENDING_VERIFICATION' ? { status: 'ACTIVE' } : {}),
          },
        });
        await sessions.revokeAllForUser(row.userId, 'password_reset', {}, tx);
        await audit.record(
          {
            actorId: row.userId,
            action: row.type === 'ACCOUNT_SETUP' ? 'auth.account_setup_completed' : 'auth.password_reset',
            entityType: 'user',
            entityId: row.userId,
            ...ctx,
          },
          tx,
        );
        return messaging.queue(tx, {
          userId: row.userId,
          recipient: row.user.email,
          template: 'password-changed',
          vars: { firstName: await firstNameOf(row.userId, tx) },
        });
      });
      await messaging.dispatch([message]);
    },

    async changePassword(auth, { currentPassword, newPassword }, ctx) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
      if (!(await verifyPassword(user.passwordHash, currentPassword))) {
        throw new ValidationError([
          { location: 'body', path: 'currentPassword', message: 'Current password is incorrect', code: 'invalid_password' },
        ]);
      }
      assertPolicy(newPassword, user.email, 'newPassword');
      if (currentPassword === newPassword) {
        throw new ValidationError([
          { location: 'body', path: 'newPassword', message: 'Choose a different password', code: 'password_reuse' },
        ]);
      }
      const passwordHash = await hashPassword(newPassword);
      const message = await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
        const revoked = await sessions.revokeAllForUser(user.id, 'password_changed', { exceptSessionId: auth.session.id }, tx);
        await audit.record(
          {
            actorId: user.id,
            action: 'auth.password_changed',
            entityType: 'user',
            entityId: user.id,
            metadata: { sessionsRevoked: revoked },
            ...ctx,
          },
          tx,
        );
        return messaging.queue(tx, {
          userId: user.id,
          recipient: user.email,
          template: 'password-changed',
          vars: { firstName: await firstNameOf(user.id, tx) },
        });
      });
      await messaging.dispatch([message]);
    },
  };
}
