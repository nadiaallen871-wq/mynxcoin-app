import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** URL-safe random token with `bytes` of entropy (default 256 bits). */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/** Uniformly random numeric code (e.g. 6-digit SMS code). Uses rejection sampling via crypto.randomInt. */
export function randomNumericCode(digits = 6) {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

/** Hex HMAC-SHA256. Used to store tokens: a DB leak does not reveal usable tokens without the key. */
export function hmacSha256(key, value) {
  return createHmac('sha256', key).update(value).digest('hex');
}

/** Hex HMAC-SHA512, the webhook signature scheme used by Paystack and the sandbox provider. */
export function hmacSha512(key, value) {
  return createHmac('sha512', key).update(value).digest('hex');
}

/** Constant-time string comparison. Returns false (not throws) on length mismatch. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Authenticated encryption (AES-256-GCM) for small secrets at rest.
 * Output: base64url(iv).base64url(tag).base64url(ciphertext)
 */
export function createCipher(base64Key) {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64url')).join('.');
    },
    decrypt(payload) {
      const [iv, tag, ciphertext] = String(payload)
        .split('.')
        .map((part) => Buffer.from(part, 'base64url'));
      if (!iv || !tag || !ciphertext || iv.length !== 12 || tag.length !== 16) throw new Error('Malformed ciphertext');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
  };
}
