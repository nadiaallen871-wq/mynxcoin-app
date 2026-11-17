# Authentication and access control

## Sessions

- After a successful login the server creates a `user_sessions` row and sets an **httpOnly, SameSite=Lax** cookie holding a
  256-bit random token (`__Host-mynx_sid` in production, `mynx_sid` in development). Only `HMAC-SHA256(SESSION_SECRET, token)`
  is stored, so a database leak cannot be replayed as a cookie.
- Expiry: **30 minutes idle**, **12 hours absolute** (`SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`). MFA-pending sessions expire after 10 minutes.
- Revocation is immediate: logout, "sign out other devices", password change/reset, admin suspension and admin "revoke sessions"
  all set `revoked_at`, and every request re-checks the session.
- Suspended or closed users are rejected even with a valid cookie.

## CSRF

The SPA calls `GET /api/v1/auth/csrf`, which sets an httpOnly `mynx_csrf` cookie and returns the same token in the body. Every
POST/PUT/PATCH/DELETE must send it as `X-CSRF-Token`. Mismatches return `403 CSRF_INVALID`, and the client refreshes the token and
retries once. Provider webhooks (Phase 6) are exempt and authenticated by signature instead.

## Passwords

- Argon2id, m = 19 MiB, t = 2, p = 1 (OWASP minimum). Hashes are upgraded on login if the parameters are raised.
- Policy (NIST SP 800-63B style): 12–128 characters, not a common password, no single repeated character, must not contain the
  email local part or the platform name. No composition rules or forced rotation.
- Unknown emails still run a dummy Argon2 verification so response time does not reveal which accounts exist.

## Lockout and alerts

| Event                                               | Behaviour                                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 5 consecutive wrong passwords (`LOCKOUT_THRESHOLD`) | Account locked for 15 min (`LOCKOUT_MINUTES`); owner emailed; even the right password is rejected while locked |
| Per-IP credential attempts                          | 20 per 15 min on all credential endpoints (`AUTH_RATE_LIMIT_MAX`), shared across instances through Redis       |
| Password accepted from a new IP + device            | "New sign-in" email (also when MFA is still pending, so a stolen password is noticed)                          |
| 5 wrong MFA codes in one session                    | Pending session revoked; user must sign in again                                                               |

Every attempt is recorded in `login_attempts` (reason codes: `OK`, `MFA_PENDING`, `BAD_PASSWORD`, `UNKNOWN_EMAIL`, `LOCKED`,
`NOT_VERIFIED`, `DISABLED`, `MFA_FAILED`). Users see their last 20 attempts on the Security page.

## Multi-factor authentication (TOTP)

1. `POST /auth/mfa/setup {password}` → new secret (base32) and `otpauth://` URL. Stored AES-256-GCM encrypted (`ENCRYPTION_KEY`), not yet active.
2. `POST /auth/mfa/enable {code}` → activates it and returns **10 single-use recovery codes**, shown once (stored as HMACs).
3. At login, the session is `mfaRequired` until `POST /auth/mfa/verify {code | recoveryCode}` succeeds. Until then only `/users/me`,
   `/users/session` and `/auth/mfa/verify` accept the session.
4. Disabling MFA or regenerating codes requires the **password and a current code** (step-up).

TOTP follows RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step) and is verified against the RFC test vectors. Each time-step is accepted at
most once per user (`last_used_step`), which blocks replay.

**Staff must use MFA:** any staff permission (anything not ending in `:own`) is granted only to sessions that completed MFA. Without
it the API returns `403 MFA_ENROLLMENT_REQUIRED`, and the admin console shows an enrolment prompt.

## Authorisation

- `requirePermission(...keys)` loads the union of the user's role permissions **on every request**, so role changes apply immediately.
- Investor endpoints use `requireAuth()` and only ever act on `req.auth.user`, so a user cannot address another user's records.
- Separation of duties: conflicting pairs (`CONFLICTING_PERMISSIONS` in `config/permissions.js`) are rejected for roles and for the
  combined roles of any user. Staff cannot change their own roles or status. The last active Super Administrator cannot be removed.
- System roles are defined in code (synced by the seed) and are read-only in the admin console. Custom roles may contain only staff permissions.

## Account lifecycle

| Status                 | Meaning                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `PENDING_VERIFICATION` | Registered (or invited) but email not confirmed / password not set. Cannot sign in.         |
| `ACTIVE`               | Can sign in. Requires a password and a confirmed email (enforced by a DB check constraint). |
| `SUSPENDED`            | Blocked by an administrator; all sessions revoked.                                          |
| `LOCKED`               | Reserved for a security review hold (temporary lockouts use `locked_until`).                |
| `CLOSED`               | Account closed.                                                                             |

## Staff onboarding

- **First administrator:** `npm run admin:bootstrap --workspace server -- --email … --first … --last …` prints a single-use setup
  link (24 h). It refuses to run if a Super Administrator already exists.
- **Further staff:** invited from Admin → Users. The invitee gets an emailed setup link, chooses a password, then must enrol MFA.
  Administrators never choose or see passwords.

## Messages

Security emails and SMS are written to `outbound_messages` in the same transaction as the event (transactional outbox) and delivered
by the worker (`notifications` queue, with retries and a stale-message sweep). In sandbox mode nothing leaves the system. In
development the outbox can be read at `/dev/outbox`. In staging and production, bodies containing links or codes are redacted after delivery.
