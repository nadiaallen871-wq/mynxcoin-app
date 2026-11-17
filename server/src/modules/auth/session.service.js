import { hmacSha256, randomToken } from '../../utils/crypto.js';

const TOUCH_INTERVAL_MS = 60_000;
const MFA_PENDING_TTL_MS = 10 * 60_000;

/**
 * Server-side sessions. The browser holds a 256-bit random token in an httpOnly
 * cookie. The database stores only HMAC(SESSION_SECRET, token), so a database
 * leak cannot be replayed as a cookie.
 *
 * A session expires on idle timeout, absolute lifetime or explicit revocation.
 * Sessions awaiting an MFA challenge expire after 10 minutes.
 */
export function createSessionService({ prisma, env }) {
  const isProduction = env.NODE_ENV === 'production';
  const cookieName = isProduction ? '__Host-mynx_sid' : 'mynx_sid';
  const idleMs = env.SESSION_IDLE_MINUTES * 60_000;
  const absoluteMs = env.SESSION_ABSOLUTE_HOURS * 3_600_000;
  const hash = (token) => hmacSha256(env.SESSION_SECRET, `session:${token}`);

  function isExpired(session, now = Date.now()) {
    if (session.revokedAt) return true;
    if (session.absoluteExpiresAt.getTime() <= now) return true;
    if (session.lastSeenAt.getTime() + idleMs <= now) return true;
    if (session.mfaRequired && !session.mfaVerifiedAt && session.createdAt.getTime() + MFA_PENDING_TTL_MS <= now) return true;
    return false;
  }

  return {
    cookieName,
    cookieOptions() {
      // __Host- prefix (production) requires Secure, Path=/ and no Domain.
      return { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: absoluteMs };
    },

    async create(tx, { userId, ip, userAgent, mfaRequired }) {
      const token = randomToken(32);
      const session = await tx.userSession.create({
        data: {
          userId,
          tokenHash: hash(token),
          ipAddress: ip ?? null,
          userAgent: userAgent ? userAgent.slice(0, 512) : null,
          mfaRequired,
          absoluteExpiresAt: new Date(Date.now() + absoluteMs),
        },
      });
      return { token, session };
    },

    /** Returns { session, user } for a valid token, or null. Refreshes lastSeenAt at most once a minute. */
    async resolve(token) {
      if (typeof token !== 'string' || token.length < 32 || token.length > 128) return null;
      const session = await prisma.userSession.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
      if (!session || isExpired(session)) return null;
      if (session.user.status !== 'ACTIVE') return null;
      if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        await prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
      }
      const { user, ...rest } = session;
      return { session: rest, user };
    },

    async revoke(sessionId, reason, tx = prisma) {
      await tx.userSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
    },

    async revokeAllForUser(userId, reason, { exceptSessionId = null } = {}, tx = prisma) {
      const result = await tx.userSession.updateMany({
        where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      return result.count;
    },

    isExpired,
  };
}
