# Security

The verification framework is OWASP ASVS 5.0, targeting Level 2 for the platform and Level 3 for the ledger, payments and auth.

## Controls in place (Phase 1)

| Control                        | Implementation                                                                                                                                             | ASVS area                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Config validation, fail closed | `server/src/config/env.js`: rejects wildcard CORS, short secrets, default secrets in prod, live mode outside prod                                          | V13 Configuration              |
| Secure headers                 | Helmet: CSP `default-src 'none'`, no-referrer, HSTS in production. Nginx CSP for the SPA.                                                                  | V3 Web frontend                |
| CORS                           | Explicit allowlist with credentials. Rejections return `403 CORS_REJECTED`.                                                                                | V3                             |
| Rate limiting                  | Global API limiter. Stricter auth limiters arrive in P2.                                                                                                   | V2 / V6                        |
| Input validation               | Zod `validate()` middleware for body, query and params. 100 kB JSON limit.                                                                                 | V1 Encoding & sanitisation     |
| Error handling                 | Uniform envelope. 5xx responses never expose internals. Request ID for correlation.                                                                        | V16 Logging & errors           |
| Logging                        | Pino with redaction of auth headers, cookies, passwords, tokens, OTP/TOTP, card data and ID numbers                                                        | V16                            |
| Audit trail                    | `audit_logs` is append-only via a DB trigger. Values are scrubbed. Writes happen inside business transactions.                                             | V16                            |
| RBAC enforcement               | `requirePermission()` checks the database on every request. Staff permissions need an MFA-verified session. SoD checked for roles and combined user roles. | V8 Authorization               |
| Authentication                 | Argon2id, NIST-style policy, lockout, per-IP limits, anti-enumeration, login alerts (see authentication.md)                                                | V6 Authentication              |
| Sessions                       | Opaque httpOnly SameSite=Lax cookies (`__Host-` in prod), HMAC-stored, idle + absolute expiry, immediate revocation                                        | V7 Session management          |
| CSRF                           | Double-submit token on every state-changing request                                                                                                        | V3 / V7                        |
| MFA                            | RFC 6238 TOTP, encrypted secrets, replay protection, hashed single-use recovery codes, step-up for changes                                                 | V6                             |
| Token handling                 | Verification/reset tokens are single-use, HMAC-stored and sent in URL fragments (not logged by servers or proxies)                                         | V6 / V14                       |
| KYC documents                  | AES-256-GCM encrypted private storage, magic-byte validation, 5-min signed URLs bound to the requester, append-only access log, retention trigger          | V5 Files / V14 Data protection |
| Money safety                   | BigInt minor units. ESLint bans `parseFloat` / `toFixed` in financial modules.                                                                             | V2 Business logic              |
| Sandbox gate                   | `PLATFORM_MODE=sandbox` by default. The UI banner is driven by the server.                                                                                 | V2                             |
| Dependency scanning            | `npm audit --audit-level=high` in CI                                                                                                                       | V15 Secure coding              |

## Planned controls

- **Later hardening:** breached-password check (k-anonymity range API) once an outbound HTTP policy is agreed; WebAuthn/passkeys as a second factor.
- **P7:** extend signed-URL document access to statements and reports. Add an antivirus adapter to the upload scanner before go-live.
- **P6:** webhook HMAC verification with constant-time compare, replay protection (unique event IDs + timestamp window),
  provider re-verification before crediting.
- **P8 (done):** maker-checker for system settings and for granting the Super Administrator and Administrator roles, alongside the earlier two-person rules (ledger adjustments, product publication, KYC review, every withdrawal, referral campaigns). Other role changes and staff suspension are permission-gated and audited but use a single approver. See [administration.md](administration.md).
- **P10 (done):** internal security review, route-wide authorization sweep, dependency fix, live-mode gates. See
  [Phase 10 review](#phase-10-review) below.
- **Still open:** OWASP ZAP baseline scan against staging, external penetration test, upload antivirus adapter,
  `ENCRYPTION_KEY` rotation (re-encryption job).

## Go-live gate

Real-money operation requires **all** of the following, each recorded with its evidence before an operator sets
`platform.go_live_approved` (the setting cannot be changed from the console). The full list is in
[production-readiness.md](production-readiness.md#go-live-checklist-all-required-before-platformgo_live_approved-is-set).
The gate is enforced: with `PLATFORM_MODE=live`, configuration refuses sandbox providers, and the API and worker refuse
to start until the setting is `true`.

1. Regulatory licence or exemption confirmed in writing for each market.
2. Custody or trustee agreement for client assets, and segregated client money accounts.
3. Payment provider live accounts, with webhook endpoints verified in staging.
4. KYC/AML vendor contracted, and sanctions/PEP screening live.
5. Legal sign-off on Terms, Privacy Policy and Risk Disclosures.
6. Accountant sign-off on the chart of accounts and posting rules.
7. Penetration test findings remediated.
8. Backup restore drill passed within the last 30 days.

## Phase 10 review

Fixed (details in [production-readiness.md](production-readiness.md#security-review-phase-10)):

- **`.dockerignore` added.** Without it, `server/.env` and encrypted document storage would have been copied into images.
- **`deepmerge-ts` advisory.** It reached the build only through the Prisma CLI; the patched version is pinned and
  `npm audit --omit=dev` reports 0.
- **Go-live gate enforced** in config and at start-up (previously documented only).
- **Container storage folder** is now writable by the non-root user and declared as a volume.
- **Per-user heavy-action limiter** on PDF generation, uploads, FX quotes, exports and reports.
- **Token-protected Prometheus metrics.** Labels are route patterns only, never raw URLs or IDs.

Verified by automated tests:

- `security-sweep.test.js` discovers every route from source. It checks that only the public allow-list answers
  without a session, that an investor gets 403 on every `/admin` route, and that state-changing requests without the
  CSRF token are refused.
- Code sweeps found no `eval`/`new Function`, no raw SQL built from input (`$queryRawUnsafe` unused), no secrets in
  source, and no sensitive values in logs (pino redaction plus the outbox redaction tests).

## Secrets

Secrets come only from the environment or a secrets manager. Nothing is committed (`.env*` is git-ignored except
`.env.example`). Development credentials (`mynx_dev`) are local-only and must never be used elsewhere.
