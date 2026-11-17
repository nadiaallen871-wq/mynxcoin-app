import argon2 from 'argon2';

/**
 * Argon2id with OWASP-recommended minimum parameters (m = 19 MiB, t = 2, p = 1).
 * Parameters are encoded in the PHC hash string, so they can be raised later.
 * `needsRehash` upgrades old hashes on the next successful login.
 */
export const ARGON2_OPTIONS = Object.freeze({ type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function hashPassword(password) {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash, password) {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function needsRehash(hash) {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}

// Hash of a random value, verified when an email is unknown so response
// timing does not reveal which accounts exist. Computed once at first use.
let dummyHashPromise;
export async function burnPasswordCheck(password) {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHashPromise, password);
  return false;
}

/** Small denylist of the most common passwords that pass the length rule. */
const COMMON = new Set([
  'password1234',
  'password12345',
  '123456789012',
  'qwertyuiop12',
  'iloveyou1234',
  'administrator',
  'letmein12345',
  'welcome12345',
  'changeme1234',
  'passw0rd1234',
  'qwerty123456',
  '1q2w3e4r5t6y',
  'abc123456789',
  'mynxpassword',
]);

/**
 * NIST SP 800-63B style policy: length over composition rules. Long passphrases
 * are encouraged, and known-bad and context-specific passwords are rejected.
 * Returns an error message, or null when acceptable.
 */
export function checkPasswordPolicy(password, { email } = {}) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common. Choose something less predictable';
  if (/^(.)\1+$/.test(password)) return 'Avoid repeating a single character';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'Your password must not contain your email address';
  if (lower.includes('mynx')) return 'Your password must not contain the platform name';
  return null;
}
