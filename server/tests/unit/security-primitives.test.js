import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUrl, timeStep, totp, verifyTotp } from '../../src/utils/totp.js';
import { createCipher, hmacSha256, randomNumericCode, safeEqual } from '../../src/utils/crypto.js';
import { checkPasswordPolicy, hashPassword, needsRehash, verifyPassword } from '../../src/modules/auth/password.js';
import { normalizePhone } from '../../src/modules/users/users.service.js';
import { findConflict } from '../../src/modules/admin/access.service.js';

// RFC 6238 Appendix B (SHA-1). The ASCII secret "12345678901234567890" in base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches the RFC test vector at T=%i', (seconds, expected) => {
    expect(hotp(base32Decode(RFC_SECRET), timeStep(seconds * 1000), 8)).toBe(expected);
    expect(totp(RFC_SECRET, seconds * 1000)).toBe(expected.slice(-6));
  });

  it('round-trips base32', () => {
    const buf = Buffer.from('any carnal pleasure.');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(() => base32Decode('not*base32')).toThrow();
  });

  it('accepts codes within ±1 step and rejects older ones', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), { nowMs: now })).toBe(timeStep(now) - 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90_000), { nowMs: now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', { nowMs: now })).toBeNull();
  });

  it('rejects replay of a used step', () => {
    const now = 1_700_000_000_000;
    const code = totp(RFC_SECRET, now);
    const step = verifyTotp(RFC_SECRET, code, { nowMs: now });
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, afterStep: step })).toBeNull();
  });

  it('builds an otpauth URL for authenticator apps', () => {
    expect(otpauthUrl({ secret: 'ABC', accountName: 'a@b.test', issuer: 'Mynx' })).toBe(
      'otpauth://totp/Mynx%3Aa%40b.test?secret=ABC&issuer=Mynx&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('crypto helpers', () => {
  const cipher = createCipher(Buffer.alloc(32, 7).toString('base64'));

  it('encrypts with a fresh IV and decrypts', () => {
    const a = cipher.encrypt('secret');
    expect(a).not.toBe(cipher.encrypt('secret'));
    expect(cipher.decrypt(a)).toBe('secret');
  });

  it('detects tampering (GCM authentication)', () => {
    const [iv, tag, ct] = cipher.encrypt('secret').split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() => cipher.decrypt([iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
    expect(() => createCipher(Buffer.alloc(32, 8).toString('base64')).decrypt([iv, tag, ct].join('.'))).toThrow();
  });

  it('compares in constant time and handles length mismatches', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(undefined, 'a')).toBe(false);
  });

  it('produces fixed-length numeric codes and keyed hashes', () => {
    for (let i = 0; i < 100; i++) expect(randomNumericCode(6)).toMatch(/^\d{6}$/);
    expect(hmacSha256('k', 'v')).toHaveLength(64);
    expect(hmacSha256('k', 'v')).not.toBe(hmacSha256('k2', 'v'));
  });
});

describe('password hashing and policy', () => {
  it('hashes with Argon2id and verifies', async () => {
    const hash = await hashPassword('a long enough passphrase');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, 'a long enough passphrase')).toBe(true);
    expect(await verifyPassword(hash, 'wrong passphrase!')).toBe(false);
    expect(await verifyPassword(null, 'x')).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it.each([
    ['short', /at least 12/],
    ['password1234', /too common/],
    ['aaaaaaaaaaaaaaa', /repeating/],
    ['kwame.asante-2026!', /email/],
    ['ilovemynx2026!!', /platform name/],
  ])('rejects %s', (pw, message) => {
    expect(checkPasswordPolicy(pw, { email: 'kwame.asante@example.test' })).toMatch(message);
  });

  it('accepts a long passphrase', () => {
    expect(checkPasswordPolicy('correct horse battery staple', { email: 'a@b.test' })).toBeNull();
  });
});

describe('phone normalisation', () => {
  it.each([
    ['0241234567', '+233241234567'],
    ['024 123 4567', '+233241234567'],
    ['+233241234567', '+233241234567'],
    ['+44 20 7946 0958', '+442079460958'],
    ['12345', null],
    ['+0123456789', null],
  ])('%s → %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));
});

describe('separation of duties', () => {
  it('detects conflicting permission pairs', () => {
    expect(findConflict(['ledger:adjustment:initiate', 'ledger:adjustment:approve'])).toEqual([
      'ledger:adjustment:initiate',
      'ledger:adjustment:approve',
    ]);
    expect(findConflict(['ledger:read', 'ledger:adjustment:approve'])).toBeNull();
  });
});
