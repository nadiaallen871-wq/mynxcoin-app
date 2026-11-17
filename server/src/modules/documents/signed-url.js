import { hmacSha256, safeEqual } from '../../utils/crypto.js';

/**
 * Short-lived signed download tokens: base64url(payload).hmac
 * payload = { d: documentId, a: actorId, e: expiry (epoch seconds) }
 *
 * The token is bound to the actor that requested it, so the download endpoint
 * still requires that same user's session. A leaked URL is useless to anyone else
 * and expires within minutes.
 */
export function createUrlSigner({ secret, ttlSeconds }) {
  const sign = (body) => hmacSha256(secret, `docurl:${body}`);

  return {
    ttlSeconds,
    issue({ documentId, actorId, now = Date.now() }) {
      const expiresAt = Math.floor(now / 1000) + ttlSeconds;
      const body = Buffer.from(JSON.stringify({ d: documentId, a: actorId, e: expiresAt })).toString('base64url');
      return { token: `${body}.${sign(body)}`, expiresAt: new Date(expiresAt * 1000) };
    },
    /** Returns { documentId, actorId } or null if the token is malformed, tampered with or expired. */
    verify(token, { now = Date.now() } = {}) {
      if (typeof token !== 'string' || token.length > 600) return null;
      const [body, signature] = token.split('.');
      if (!body || !signature || !safeEqual(sign(body), signature)) return null;
      try {
        const { d, a, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (typeof d !== 'string' || typeof a !== 'string' || typeof e !== 'number') return null;
        if (e * 1000 <= now) return null;
        return { documentId: d, actorId: a };
      } catch {
        return null;
      }
    },
  };
}
