import { randomNumericCode, safeEqual } from '../../utils/crypto.js';
import { AppError, BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';

const PHONE_MAX_ATTEMPTS = 5;
const PHONE_RESEND_COOLDOWN_MS = 60_000;

/** Normalises Ghanaian local numbers (0XXXXXXXXX) and E.164 input to E.164. */
export function normalizePhone(input) {
  const digits = String(input ?? '').replace(/[\s()-]/g, '');
  if (/^0\d{9}$/.test(digits)) return `+233${digits.slice(1)}`;
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

/** Self-service account: profile, phone verification, sessions and sign-in history. */
export function createUsersService({ prisma, tokens, messaging, audit, users, mfa, sessions }) {
  return {
    async me(auth) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, include: { profile: true } });
      const pending = auth.mfaPending;
      return {
        user: {
          id: user.id,
          email: user.email,
          type: user.type,
          status: user.status,
          emailVerified: Boolean(user.emailVerifiedAt),
          phone: user.phone,
          phoneVerified: Boolean(user.phoneVerifiedAt),
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
        },
        profile: user.profile && {
          firstName: user.profile.firstName,
          lastName: user.profile.lastName,
          organizationName: user.profile.organizationName,
          country: user.profile.country,
        },
        // Nothing beyond identity is released until the MFA challenge is complete.
        roles: pending ? [] : await users.roleKeys(user.id),
        permissions: pending ? [] : await auth.permissions(),
        mfa: pending ? null : await mfa.status(user.id),
        session: { id: auth.session.id, mfaPending: pending, mfaVerified: Boolean(auth.session.mfaVerifiedAt) },
      };
    },

    async updateProfile(auth, input, ctx) {
      return prisma.$transaction(async (tx) => {
        const before = await tx.userProfile.findUnique({ where: { userId: auth.user.id } });
        if (!before) throw new NotFoundError('Profile not found');
        if (input.organizationName !== undefined && auth.user.type !== 'INSTITUTIONAL') {
          throw new BadRequestError('Only institutional accounts have an organisation name', 'NOT_INSTITUTIONAL');
        }
        const after = await tx.userProfile.update({ where: { userId: auth.user.id }, data: input });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'user.profile_updated',
            entityType: 'user',
            entityId: auth.user.id,
            before: {
              firstName: before.firstName,
              lastName: before.lastName,
              organizationName: before.organizationName,
              country: before.country,
            },
            after: input,
            ...ctx,
          },
          tx,
        );
        return { firstName: after.firstName, lastName: after.lastName, organizationName: after.organizationName, country: after.country };
      });
    },

    async startPhoneVerification(auth, { phone: rawPhone }, ctx) {
      const phone = normalizePhone(rawPhone);
      if (!phone) throw new BadRequestError('Enter a valid phone number, e.g. 024 123 4567 or +233241234567', 'PHONE_INVALID');
      const owner = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
      if (owner && owner.id !== auth.user.id) throw new ConflictError('This phone number is linked to another account', 'PHONE_IN_USE');
      const recent = await prisma.verificationToken.findFirst({
        where: { userId: auth.user.id, type: 'PHONE_VERIFICATION', createdAt: { gt: new Date(Date.now() - PHONE_RESEND_COOLDOWN_MS) } },
      });
      if (recent) throw new AppError('Please wait a minute before requesting another code', { status: 429, code: 'CODE_COOLDOWN' });

      const code = randomNumericCode(6);
      const { row, message } = await prisma.$transaction(async (tx) => {
        const issued = await tokens.issue(tx, {
          userId: auth.user.id,
          type: 'PHONE_VERIFICATION',
          target: phone,
          raw: code,
          hashInput: `${auth.user.id}:${code}`,
        });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'user.phone_verification_started',
            entityType: 'user',
            entityId: auth.user.id,
            metadata: { phone },
            ...ctx,
          },
          tx,
        );
        const msg = await messaging.queue(tx, {
          userId: auth.user.id,
          channel: 'SMS',
          recipient: phone,
          template: 'phone-code',
          vars: { code },
        });
        return { row: issued.row, message: msg };
      });
      await messaging.dispatch([message]);
      return { phone, expiresAt: row.expiresAt };
    },

    async verifyPhone(auth, { code }, ctx) {
      const row = await prisma.verificationToken.findFirst({
        where: { userId: auth.user.id, type: 'PHONE_VERIFICATION', consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const invalid = () => new BadRequestError('That code is incorrect or has expired. Request a new code.', 'CODE_INVALID');
      if (!row || row.expiresAt <= new Date() || row.attempts >= PHONE_MAX_ATTEMPTS) throw invalid();

      if (!safeEqual(tokens.hash('PHONE_VERIFICATION', `${auth.user.id}:${code}`), row.tokenHash)) {
        const updated = await prisma.verificationToken.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
        if (updated.attempts >= PHONE_MAX_ATTEMPTS)
          await prisma.verificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
        throw invalid();
      }

      try {
        await prisma.$transaction(async (tx) => {
          if (!(await tokens.consume(tx, row.id))) throw invalid();
          await tx.user.update({ where: { id: auth.user.id }, data: { phone: row.target, phoneVerifiedAt: new Date() } });
          await audit.record(
            {
              actorId: auth.user.id,
              action: 'user.phone_verified',
              entityType: 'user',
              entityId: auth.user.id,
              metadata: { phone: row.target },
              ...ctx,
            },
            tx,
          );
        });
      } catch (err) {
        if (err.code === 'P2002') throw new ConflictError('This phone number is linked to another account', 'PHONE_IN_USE');
        throw err;
      }
      return { phone: row.target };
    },

    async listSessions(auth) {
      const rows = await prisma.userSession.findMany({
        where: { userId: auth.user.id, revokedAt: null, absoluteExpiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
      });
      return rows
        .filter((s) => !sessions.isExpired(s))
        .map((s) => ({
          id: s.id,
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          current: s.id === auth.session.id,
        }));
    },

    async revokeSession(auth, sessionId, ctx) {
      const session = await prisma.userSession.findFirst({ where: { id: sessionId, userId: auth.user.id } });
      if (!session) throw new NotFoundError('Session not found');
      await sessions.revoke(session.id, session.id === auth.session.id ? 'logout' : 'revoked_by_user');
      await audit.record({ actorId: auth.user.id, action: 'session.revoked', entityType: 'session', entityId: session.id, ...ctx });
      return { current: session.id === auth.session.id };
    },

    async revokeOtherSessions(auth, ctx) {
      const count = await sessions.revokeAllForUser(auth.user.id, 'revoked_by_user', { exceptSessionId: auth.session.id });
      await audit.record({
        actorId: auth.user.id,
        action: 'session.revoked_others',
        entityType: 'user',
        entityId: auth.user.id,
        metadata: { count },
        ...ctx,
      });
      return { revoked: count };
    },

    async loginHistory(auth, { limit = 20 } = {}) {
      const rows = await prisma.loginAttempt.findMany({
        where: { userId: auth.user.id },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 50),
        select: { id: true, success: true, reason: true, ipAddress: true, userAgent: true, createdAt: true },
      });
      return rows.map((r) => ({ ...r, id: r.id.toString() }));
    },
  };
}
