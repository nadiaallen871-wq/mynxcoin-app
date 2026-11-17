# Production readiness assessment

**Status (2026-11-14): ready for a staging deployment in sandbox mode. Not ready for real money.** The software side of
the platform is built and verified. Real-money operation depends on legal, regulatory, provider and operational
prerequisites that cannot be met in code. Live mode is deliberately impossible until they are:

- configuration refuses `PLATFORM_MODE=live` while any provider is a sandbox
- the API and worker refuse to start in live mode until `platform.go_live_approved` is set

## Quality acceptance criteria (from the build specification)

| Criterion                                                      | Status               | Evidence                                                                                                                                                                                      |
| -------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All 16 core modules implemented                                | ✅                   | See the module table below and the traceability matrix in [implementation-checklist.md](implementation-checklist.md)                                                                          |
| All 8 engineering requirements implemented                     | ✅ with noted gaps   | See the engineering table below                                                                                                                                                               |
| Additional capabilities implemented or dependencies documented | ✅                   | [advanced-capabilities.md](advanced-capabilities.md)                                                                                                                                          |
| React frontend connects to backend APIs                        | ✅                   | Playwright journeys against the real API ([testing.md](testing.md))                                                                                                                           |
| Backend connects to PostgreSQL                                 | ✅                   | All integration tests run on PostgreSQL                                                                                                                                                       |
| Database migrations work                                       | ✅                   | Applied from scratch in CI; drift check; restore drill confirms migrations restore                                                                                                            |
| Authentication works                                           | ✅                   | `auth.test.js`, `mfa.test.js`; E2E sign-in with MFA                                                                                                                                           |
| Permissions are enforced                                       | ✅                   | Route-wide authorization sweep (`security-sweep.test.js`), per-module tests                                                                                                                   |
| Financial ledger entries balance                               | ✅                   | Deferred DB trigger per currency; reconciliation after money tests; restore drill re-checks                                                                                                   |
| Duplicate financial requests are prevented                     | ✅                   | Idempotency keys, single-use quotes, conditional state transitions; racing-submission tests                                                                                                   |
| Payment webhooks authenticated and replay-safe                 | ✅                   | HMAC-SHA512 constant-time check, unique event IDs, provider re-verification (`payments.test.js`)                                                                                              |
| Investment processing is transaction-safe                      | ✅                   | Row locks on capacity, atomic reservation, state machines (`orders.test.js`, `critical-paths.test.js`)                                                                                        |
| Administrative actions are audited                             | ✅                   | Append-only `audit_logs`; viewer with export                                                                                                                                                  |
| Error handling is consistent                                   | ✅                   | One error envelope with request IDs; 5xx never leak internals                                                                                                                                 |
| Automated tests pass                                           | ✅                   | Server 299, client 28, E2E 20 passed + 1 skipped (locally, 2026-11-14); all CI jobs green on GitHub ([2026-11-17](https://github.com/nadiaallen871-wq/mynxcoin-app/actions/runs/44070881534)) |
| Production builds succeed                                      | ✅                   | `npm run build`; E2E runs against the production bundle                                                                                                                                       |
| Backup and recovery procedures tested                          | ✅ (logical backups) | `npm run backup:drill` passed on dev and test databases; PITR not yet set up (no hosting)                                                                                                     |
| Security findings reviewed and addressed                       | ✅ (internal review) | Below. An external penetration test is a go-live prerequisite                                                                                                                                 |

### Core modules

| #   | Module                   | Status                                                                     | Main documentation                                                                       |
| --- | ------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Authentication           | ✅                                                                         | [authentication.md](authentication.md)                                                   |
| 2   | Investor onboarding      | ✅                                                                         | [kyc-onboarding.md](kyc-onboarding.md)                                                   |
| 3   | Investor dashboard       | ✅                                                                         | [investor-experience.md](investor-experience.md)                                         |
| 4   | Investment marketplace   | ✅                                                                         | [marketplace.md](marketplace.md)                                                         |
| 5   | Investment engine        | ✅                                                                         | [payments.md](payments.md)                                                               |
| 6   | Wallet                   | ✅                                                                         | [financial-ledger.md](financial-ledger.md)                                               |
| 7   | Payment integrations     | 🟡 Sandbox complete; Paystack collections only, never run against Paystack | [payments.md](payments.md)                                                               |
| 8   | Portfolio management     | ✅ (no market price feed: accrual or cost valuation)                       | [investor-experience.md](investor-experience.md)                                         |
| 9   | Analytics and reporting  | ✅                                                                         | [investor-experience.md](investor-experience.md), [administration.md](administration.md) |
| 10  | Notifications            | 🟡 In-app complete; email/SMS sandbox only; no push                        | [investor-experience.md](investor-experience.md)                                         |
| 11  | Referral system          | ✅                                                                         | [investor-experience.md](investor-experience.md)                                         |
| 12  | Document management      | ✅ (local encrypted storage; no object-storage driver)                     | [investor-experience.md](investor-experience.md)                                         |
| 13  | Customer support         | ✅                                                                         | [investor-experience.md](investor-experience.md)                                         |
| 14  | Administration dashboard | ✅                                                                         | [administration.md](administration.md), [admin-guide.md](admin-guide.md)                 |
| 15  | Compliance               | ✅ workflows; screening adapter sandbox only                               | [administration.md](administration.md)                                                   |
| 16  | Security                 | ✅ internal review; external pen test pending                              | [security.md](security.md)                                                               |

### Engineering requirements

| Requirement                               | Status | Notes                                                                                                                                                            |
| ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Double-entry ledger                    | ✅     | [financial-ledger.md](financial-ledger.md). Accountant sign-off on the chart of accounts is a go-live item                                                       |
| B. Transaction-safe processing            | ✅     | Proven under concurrency in tests                                                                                                                                |
| C. RBAC                                   | ✅     | DB-checked on every request; MFA required for staff; separation of duties                                                                                        |
| D. Validation, rate limiting, idempotency | ✅     | Zod on every route; per-IP, per-auth and per-user heavy limits; versioned `/api/v1`                                                                              |
| E. Backups and DR                         | 🟡     | Logical-backup drill automated and passing (weekly in CI). PITR, off-site storage and retention depend on the hosting choice                                     |
| F. Testing                                | ✅     | Unit, integration, API, E2E, security sweep, ledger balancing, concurrency, webhook replay, permissions, migrations                                              |
| G. Observability                          | 🟡     | Structured logs with request IDs and timing; `/health`, `/health/ready`, token-protected Prometheus metrics. No error-tracking service connected (vendor choice) |
| H. Environment separation                 | ✅     | Validated config per environment; sandbox by default; test runners refuse non-test databases                                                                     |

## Security review (Phase 10)

Scope: automated sweeps of the whole codebase and API, dependency audit, and a review of deployment artefacts against
OWASP ASVS 5.0 areas.

| #   | Finding                                                                                                                                      | Severity           | Resolution                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | No `.dockerignore`: `server/.env` (session secret, encryption key) and encrypted KYC storage would be copied into every API image            | High               | Fixed: `.dockerignore` excludes secrets, storage, tests and VCS                                                                                              |
| 2   | Prisma CLI depended on `deepmerge-ts` < 8 (GHSA-ggr8-5vv4-36mx, stack exhaustion). Not reachable from requests, but failed the CI audit gate | High (audit)       | Fixed: patched 8.0.2 pinned via `overrides`; Prisma CLI verified (validate, migrate, generate); audit now 0                                                  |
| 3   | `platform.go_live_approved` documented as a gate but not enforced; live mode would have silently used sandbox email, SMS and screening       | High               | Fixed: config refuses live mode with sandbox providers; API and worker refuse live mode without go-live approval (`go-live.test.js`)                         |
| 4   | API container's document storage folder not writable by the non-root user (uploads would fail)                                               | Medium             | Fixed: storage folder owned by the app user, declared as a volume; healthcheck added                                                                         |
| 5   | Expensive endpoints (PDF generation, uploads, quotes, exports, reports) limited only by the global per-IP limit                              | Medium             | Fixed: per-user heavy-action limiter (`HEAVY_RATE_LIMIT_MAX`, default 30/min)                                                                                |
| 6   | Default 5 s interactive-transaction limit caused 500s on sign-in while the database was slow                                                 | Low                | Fixed: 15 s transaction timeout, 5 s pool wait                                                                                                               |
| 7   | No metrics for latency and error rates                                                                                                       | Low                | Fixed: Prometheus endpoint, token-protected, route patterns only                                                                                             |
| 8   | Route-wide authorization                                                                                                                     | Verified           | Sweep over every discovered route: no endpoint reachable without a session except the public list; no admin endpoint reachable by an investor; CSRF enforced |
| 9   | `dangerouslySetInnerHTML` in the MFA QR code                                                                                                 | Accepted           | The SVG is generated locally from the server's otpauth URL; no user input reaches it                                                                         |
| 10  | Audit search by action prefix scans by primary key                                                                                           | Accepted (scale)   | Fine at current volume. Add date filters or partition `audit_logs` when it reaches millions of rows                                                          |
| 11  | No breached-password check, no passkeys                                                                                                      | Accepted (planned) | Needs an outbound HTTP policy; listed in security.md                                                                                                         |
| 12  | No antivirus scanning of uploads (magic-byte checks only)                                                                                    | Open, go-live item | Add a scanning adapter (e.g. ClamAV or the storage provider's scanner) before live                                                                           |

Not done: an OWASP ZAP baseline scan (no tooling on this machine; add as a CI job against staging), and an external
penetration test (go-live prerequisite).

## Performance

`npm run perf:smoke` with 200 requests per endpoint, 20 concurrent, on a 4-core development machine, after the Phase 10
fixes:

| Endpoint                    | p50    | p95    |
| --------------------------- | ------ | ------ |
| Portfolio dashboard         | 204 ms | 330 ms |
| Wallet                      | 142 ms | 191 ms |
| Portfolio history           | 105 ms | 163 ms |
| Notifications               | 82 ms  | 101 ms |
| Investment catalogue        | 158 ms | 198 ms |
| Admin overview (10 s cache) | 109 ms | 139 ms |
| Audit log                   | 198 ms | 420 ms |

These are in-process numbers on development hardware with a small database, useful as a regression alarm (CI fails
above 500 ms p95). Capacity must be measured on staging with production-like data volumes. `EXPLAIN ANALYZE` of the hot
queries confirmed index use (dashboard, statements, monitoring, risk score).

## Staging deployment

**Not performed.** There is no hosting account, domain or container registry for this project, and Docker is not
installed on the development machine. What exists:

- Dockerfiles for the API/worker and the web app (non-root, healthchecked). They build in CI (`images` job, green on
  2026-11-17). They are not pushed and have not yet been run as containers.
- `docker-compose.yml` for a staging-like stack.
- [deployment.md](deployment.md) with the target topology and runbook.

To deploy staging:

1. Choose hosting: managed PostgreSQL with PITR, managed Redis, a container platform and object storage.
2. Create secrets: `SESSION_SECRET`, `ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY`, `METRICS_TOKEN`.
3. Push the images, run the `migrate` job, then start the API, worker and web.
4. Point the restore drill at staging, run the Playwright suite against the staging URL, and run a ZAP baseline scan.

## Go-live checklist (all required before `platform.go_live_approved` is set)

Legal and regulatory:

1. Licence or exemption confirmed in writing for each market (for Ghana, the SEC Ghana regime for the activities
   offered).
2. Legal sign-off on terms, privacy policy, risk disclosures, referral promotion wording and the investor guide.
3. Data protection registration and a DPIA (Ghana Data Protection Commission).
4. Record-retention schedule decided per record type; archival and lawful deletion implemented.

Money and providers:

5. Custody or trustee agreement and segregated client-money accounts.
6. Payment provider live accounts, a payouts adapter, and webhooks verified on staging.
7. FX licence or banking partner and a live rate source, if non-GHS wallets are offered.
8. Accountant sign-off on the chart of accounts and posting rules.

Compliance:

9. KYC/AML and sanctions/PEP screening vendor contracted and its adapter built; monitoring thresholds tuned with the
   compliance officer.
10. Tax adviser review: tax rules entered and approved; decision on withholding.

Security and operations:

11. External penetration test, with findings fixed.
12. Upload antivirus adapter, plus an email/SMS provider adapter with SPF/DKIM/DMARC.
13. Error-tracking and alerting connected; on-call rota and incident runbook rehearsed.
14. PITR backups configured, and the restore drill passing on production-like infrastructure within the last 30 days.
15. Staging soak test with production-like data; capacity measured.

Each item should be recorded with its evidence (for example as an approved request or a signed document) before an
operator sets `platform.go_live_approved`.
