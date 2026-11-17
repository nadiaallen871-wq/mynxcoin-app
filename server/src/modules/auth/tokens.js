import { hmacSha256, randomToken } from '../../utils/crypto.js';

/**
 * Single-use verification tokens. Only HMAC(secret, type:token) is stored.
 * `consume` is race-safe: the conditional update succeeds for exactly one caller.
 */
export const TOKEN_TTL_MS = Object.freeze({
  EMAIL_VERIFICATION: 24 * 3_600_000,
  PASSWORD_RESET: 30 * 60_000,
  ACCOUNT_SETUP: 24 * 3_600_000,
  PHONE_VERIFICATION: 10 * 60_000,
});

export function createTokenService({ prisma, env }) {
  const hash = (type, raw) => hmacSha256(env.SESSION_SECRET, `${type}:${raw}`);

  return {
    hash,

    /** Issues a new token and invalidates any outstanding tokens of the same type for the user. */
    async issue(tx, { userId, type, target = null, raw = randomToken(32), hashInput = raw }) {
      await tx.verificationToken.updateMany({ where: { userId, type, consumedAt: null }, data: { consumedAt: new Date() } });
      const row = await tx.verificationToken.create({
        data: { userId, type, target, tokenHash: hash(type, hashInput), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type]) },
      });
      return { raw, row };
    },

    /** Finds a usable token of one of `types`. Returns the row with its user, or null. */
    async find(raw, types, tx = prisma) {
      if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) return null;
      for (const type of types) {
        const row = await tx.verificationToken.findUnique({ where: { tokenHash: hash(type, raw) }, include: { user: true } });
        if (row && row.type === type && !row.consumedAt && row.expiresAt > new Date()) return row;
      }
      return null;
    },

    async consume(tx, id) {
      const { count } = await tx.verificationToken.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
      return count === 1;
    },

    /** Builds an app link. The token travels in the URL fragment, which browsers never send to servers or in Referer headers. */
    link(path, raw) {
      return `${env.APP_BASE_URL}${path}#token=${encodeURIComponent(raw)}`;
    },
  };
}
