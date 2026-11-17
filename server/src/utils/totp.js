import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from './crypto.js';

/**
 * RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s step), compatible with standard
 * authenticator apps. Implemented on node:crypto to avoid a dependency, and
 * tested against the RFC 6238 test vectors.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input) {
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32-encoded (the format authenticator apps expect). */
export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function timeStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/** HOTP value for a counter (RFC 4226). `key` is a Buffer. */
export function hotp(key, counter, digits = DIGITS, algorithm = 'sha1') {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, key).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, '0');
}

export function totp(secretBase32, nowMs = Date.now()) {
  return hotp(base32Decode(secretBase32), timeStep(nowMs));
}

/**
 * Verifies a code within ±`window` steps of now. Returns the matched step
 * (to persist for replay protection), or null. Steps <= `afterStep` are rejected,
 * so the same code (or an older one) can never be used twice.
 */
export function verifyTotp(secretBase32, code, { nowMs = Date.now(), window = 1, afterStep = null } = {}) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretBase32);
  const current = timeStep(nowMs);
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (afterStep !== null && step <= afterStep) continue;
    if (safeEqual(hotp(key, step), code)) return step;
  }
  return null;
}

export function otpauthUrl({ secret, accountName, issuer }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}
