# Implementation checklist and requirements traceability

Status legend: ✅ done and verified · 🟡 partial · ⬜ not started · 🔒 blocked on an external prerequisite

This matrix is updated at the end of every phase. A feature is only ✅ when it
has a working backend, persistence, UI (if user-facing) and tests. Mockups and
hardcoded responses don't count.

## Phase 1: Foundation

| Requirement                                             | Status | Files                                                       | Tests                                       | Notes                                                    |
| ------------------------------------------------------- | ------ | ----------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| Workspace inspected, monorepo initialised               | ✅     | `package.json` (npm workspaces)                             | n/a                                         |                                                          |
| React + Vite + Tailwind + Router + TanStack Query       | ✅     | `client/`                                                   | `client/src/**/*.test.jsx`                  |                                                          |
| Express 5 API with layered structure, `/api/v1`         | ✅     | `server/src/app.js`, `server/src/modules/`                  | `server/tests/integration/app.test.js`      |                                                          |
| Env config validated with Zod                           | ✅     | `server/src/config/env.js`                                  | `server/tests/unit/env.test.js`             |                                                          |
| Structured logging with secret redaction                | ✅     | `server/src/config/logger.js`                               | `server/tests/unit/logger.test.js`          |                                                          |
| Helmet, CORS allowlist, rate limiting, request IDs      | ✅     | `server/src/middleware/`                                    | `app.test.js`                               |                                                          |
| Consistent error envelope                               | ✅     | `server/src/middleware/error-handler.js`, `utils/errors.js` | `app.test.js`                               |                                                          |
| Money utilities (BigInt minor units, explicit rounding) | ✅     | `server/src/utils/money.js`                                 | `server/tests/unit/money.test.js`           |                                                          |
| PostgreSQL + Prisma + first migration                   | ✅     | `server/prisma/`                                            | `server/tests/integration/database.test.js` |                                                          |
| Append-only audit log (DB trigger)                      | ✅     | migration `20261108030025_foundation`                       | `database.test.js`                          |                                                          |
| RBAC catalogue (10 roles, permission set) seeded        | ✅     | `server/src/config/permissions.js`, `prisma/seed.js`        | `database.test.js`                          | enforced since Phase 2                                   |
| Redis + BullMQ with retry, backoff, DLQ                 | ✅     | `server/src/jobs/`                                          | `server/tests/integration/queue.test.js`    |                                                          |
| Health and readiness endpoints                          | ✅     | `server/src/modules/health/`                                | `app.test.js`                               |                                                          |
| Docker Compose, Dockerfiles, Nginx                      | 🟡     | `docker-compose.yml`, `infrastructure/`                     | n/a                                         | Written. Not run: Docker isn't installed on this machine |
| ESLint + Prettier                                       | ✅     | `eslint.config.js`, `.prettierrc.json`                      | `npm run lint`                              |                                                          |
| CI pipeline                                             | 🟡     | `.github/workflows/ci.yml`                                  | n/a                                         | Written. Runs once the repo is pushed to GitHub          |
| Design system and three layouts                         | ✅     | `client/src/components/ui/`, `client/src/layouts/`          | component tests                             |                                                          |
| Architecture docs                                       | ✅     | `documentation/`                                            | n/a                                         |                                                          |

### Phase 1 verification log (2026-11-08)

- `npm test`: server 58/58 (unit + integration against real PostgreSQL 18 and Redis-compatible Memurai), client 10/10.
- `npm run lint`, `prettier --check`, `npm run build`: all clean. The dev-only design-system chunk is excluded from production builds.
- Ran the API, worker and Vite client together. `/api/v1/health/ready` reported database, Redis and worker heartbeat `up`. The `/status` page rendered the live data with no console errors.
- Not verified: Docker Compose and Dockerfiles (Docker isn't installed), and the CI workflow (the repo isn't on GitHub yet).

## Phase 2: Authentication and users

| Requirement                                                           | Status | Files                                                                                      | Tests                           | Notes                                                                         |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------- |
| Registration (individual / institutional) with terms acceptance       | ✅     | `modules/auth/auth.service.js`, `pages/auth/RegisterPage.jsx`                              | `auth.test.js`                  | Anti-enumeration: same response for existing emails                           |
| Email verification (single-use, 24 h, HMAC-stored)                    | ✅     | `modules/auth/tokens.js`, `RecoveryPages.jsx`                                              | `auth.test.js`                  | Token travels in the URL fragment, never sent to servers                      |
| Login / logout, server-side sessions                                  | ✅     | `modules/auth/session.service.js`, `middleware/auth.js`                                    | `auth.test.js`                  | httpOnly SameSite=Lax cookie; `__Host-` prefix in production                  |
| Argon2id hashing, rehash on login, password policy                    | ✅     | `modules/auth/password.js`                                                                 | `security-primitives.test.js`   | NIST-style length + denylist + context checks                                 |
| Forgot / reset password, change password                              | ✅     | `auth.service.js`, `SecurityPage.jsx`                                                      | `auth.test.js`                  | Reset signs out all sessions; change signs out the others                     |
| CSRF protection                                                       | ✅     | `middleware/csrf.js`, `client/src/services/api.js`                                         | `auth.test.js`, `auth.test.jsx` | Double-submit token + SameSite + CORS allowlist                               |
| MFA: TOTP enrolment, challenge, recovery codes, step-up               | ✅     | `modules/auth/mfa.service.js`, `utils/totp.js`, `SecurityPage.jsx`, `MfaChallengePage.jsx` | `mfa.test.js`, RFC 6238 vectors | Secrets AES-256-GCM encrypted; replay-proof; 5 wrong codes revoke the session |
| Session management, device/session history, sign-in history           | ✅     | `users.service.js`, `SecurityPage.jsx`                                                     | `auth.test.js`                  | Idle (30 min) + absolute (12 h) expiry                                        |
| Login attempt tracking, account lockout, suspicious-login alerts      | ✅     | `auth.service.js`                                                                          | `auth.test.js`                  | 5 failures → 15 min lock + email; new-device alert                            |
| Phone verification (SMS code)                                         | ✅     | `users.service.js`, `ProfilePage.jsx`                                                      | `auth.test.js`                  | Sandbox SMS provider; 5 attempts; 60 s cooldown                               |
| Profile view / update                                                 | ✅     | `users.routes.js`, `ProfilePage.jsx`                                                       | `auth.test.js`                  | Audited with before/after                                                     |
| RBAC enforcement on API (permissions per request)                     | ✅     | `middleware/auth.js` (`requirePermission`)                                                 | `admin-access.test.js`          | Staff permissions also require an MFA-verified session                        |
| Role creation/editing, permission assignment/revocation               | ✅     | `modules/admin/access.service.js`, `RolesPage.jsx`                                         | `admin-access.test.js`          | System roles read-only; separation-of-duties checks across combined roles     |
| Admin user management (invite staff, roles, suspend, revoke sessions) | ✅     | `access.service.js`, `UsersPage.jsx`, `UserDetailPage.jsx`                                 | `admin-access.test.js`          | No self-modification; last Super Admin protected                              |
| Transactional outbox + worker delivery (email/SMS)                    | ✅     | `modules/notifications/`, `jobs/processors/notifications.js`                               | auth/MFA tests                  | Secret-bearing bodies redacted after delivery in staging/production           |
| First Super Administrator bootstrap                                   | ✅     | `server/scripts/bootstrap-admin.js`                                                        | manual run                      | Prints a one-time setup link; never a password                                |
| Redis-backed rate limits (multi-instance)                             | ✅     | `middleware/rate-limit-store.js`                                                           | `rate-limit-store.test.js`      | Auth endpoints: 20 per 15 min per IP by default                               |
| Sensitive-action approvals (maker-checker)                            | ✅     | `modules/approvals/` (Phase 8)                                                             | `administration.test.js`        | Delivered in Phase 8                                                          |
| Playwright E2E suite                                                  | ✅     | `e2e/` (Phase 10)                                                                          | `npm run test:e2e`              | Delivered in Phase 10                                                         |

### Phase 2 verification log (2026-11-08)

- `npm test`: server 128/128 (real PostgreSQL + Redis), client 18/18. Lint, Prettier, production build and schema-drift check all clean.
- Manual end-to-end run in the browser against the running API, worker and client: registered an investor → verification email delivered by the worker to the sandbox outbox → confirmed email → signed in → enrolled TOTP MFA (QR + recovery codes) → signed out → signed in with the MFA challenge. Bootstrapped a Super Administrator with the CLI script → set the password via an emailed link → the admin console showed the "two-factor required" gate → after MFA enrolment, the Users and Roles pages loaded.
- Not verified: Playwright suite (not yet written); real email/SMS providers (sandbox only by design).

## Phase 3: Onboarding and compliance

| Requirement                                                                               | Status | Files                                                     | Tests                                                 | Notes                                                                     |
| ----------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| Personal info, DOB, address, contact, occupation, source of funds, objectives, experience | ✅     | `modules/onboarding/`, `features/kyc/OnboardingForms.jsx` | `onboarding.test.js`                                  | Age ≥ 18, ID format/expiry checks; ID number encrypted                    |
| Risk tolerance questionnaire                                                              | ✅     | `onboarding.constants.js`, `RiskQuestionnaire.jsx`        | `onboarding-primitives.test.js`, `onboarding.test.js` | Server-scored, capacity-for-loss cap, append-only history                 |
| Identity verification and proof of address documents                                      | ✅     | `modules/documents/`, `DocumentsSection.jsx`              | `onboarding.test.js`                                  | Magic-byte detection, size limit, PDF active-content screen               |
| Private, encrypted document storage with controlled access                                | ✅     | `integrations/storage/local.storage.js`, `signed-url.js`  | `onboarding-primitives.test.js`, `onboarding.test.js` | AES-256-GCM at rest; 5-min signed URLs bound to the requester; access log |
| KYC application tracking and profile completion status                                    | ✅     | `onboarding.service.js`, `VerificationPage.jsx`           | `onboarding.test.js`                                  | Per-section completion, missing list, percentage                          |
| Compliance review: approve, reject, request resubmission                                  | ✅     | `modules/kyc/`, `KycQueuePage.jsx`, `KycReviewPage.jsx`   | `kyc-review.test.js`                                  | Claim/release, per-document decisions, history timeline                   |
| Review rules (SoD, docs accepted, screening, PEP → HIGH risk)                             | ✅     | `kyc.service.js`                                          | `kyc-review.test.js`                                  | Generic rejection notice (no tipping off)                                 |
| Sanctions/PEP screening integration point                                                 | 🟡     | `integrations/screening/sandbox.screening.js`             | `kyc-review.test.js`                                  | Sandbox provider only; real provider 🔒 contract                          |
| Append-only KYC history, access logs, retention of submitted documents                    | ✅     | migration `20261108120000_onboarding_kyc`                 | `onboarding.test.js`, `kyc-review.test.js`            | DB triggers                                                               |
| Antivirus scanning of uploads                                                             | ⬜     | `scanner` interface in `file-validation.js`               | —                                                     | Heuristic PDF screen only; ClamAV adapter before go-live                  |
| Third-party identity verification (document authenticity, liveness)                       | 🔒     | —                                                         | —                                                     | Needs a vendor contract; manual review in the meantime                    |

### Phase 3 verification log (2026-11-08)

- `npm test`: server 161/161 (real PostgreSQL + Redis), client 19/19. Lint, Prettier, production build and schema-drift check clean.
- Manual end-to-end run: as an investor, verified the phone, filled the personal and address sections through the UI forms, completed the
  remaining sections and uploaded four documents through the same API calls the page makes (the browser pane cannot drive file pickers),
  then submitted with the UI button. The status changed to "Submitted" and the profile locked. As a Super Administrator: the queue showed the
  application with a CLEAR screening; claimed it; opened the selfie via a signed URL (rendered as an image); accepted all documents;
  approved with a LOW rating. In the database: profile APPROVED, events SUBMITTED → UNDER_REVIEW → APPROVED, "submitted" and
  "approved" emails delivered, access log UPLOADED ×4, URL_ISSUED, DOWNLOADED.
- Bug found and fixed during the run: the client API wrapper lacked `put`. A regression test now covers every verb and multipart uploads.

## Phase 4: Investment marketplace

| Requirement                                                                         | Status | Files                                                      | Tests                                                   | Notes                                                                     |
| ----------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Product listing, categories, search, filtering, sorting, pagination                 | ✅     | `modules/investments/`, `pages/public/MarketplacePage.jsx` | `marketplace.test.js`                                   | Filters in URL; only PUBLISHED/CLOSED visible                             |
| Product details: terms, min/max, fees, risk class, duration, maturity, availability | ✅     | `ProductDetailPage.jsx`                                    | `marketplace.test.js`                                   | Fixed / target / none rate labelling                                      |
| Risk disclosures and product documentation                                          | ✅     | product `riskDisclosure`, `product_documents`              | `marketplace.test.js`                                   | PDF-only, encrypted, retained once published                              |
| Historical performance (never fabricated)                                           | ✅     | `performance_records`                                      | `marketplace.test.js`                                   | Mandatory source, completed periods only, append-only                     |
| Subscription eligibility (informational)                                            | ✅     | `products.service.js#eligibility`                          | `marketplace.test.js`                                   | KYC, account type, window, suitability vs risk profile; orders in Phase 6 |
| Investment calculator (server-side)                                                 | ✅     | `calculator.js`, `CalculatorPage.jsx`                      | `marketplace-primitives.test.js`, `marketplace.test.js` | BigInt, investor-unfavourable rounding, caveats                           |
| Create, edit, publish, suspend, close, archive (admins / investment managers)       | ✅     | `ProductsPage.jsx`, `ProductEditorPage.jsx`                | `marketplace.test.js`                                   | Immutable published terms; version snapshots; four-eyes publishing        |
| Category management                                                                 | 🟡     | `/admin/products/categories` API                           | —                                                       | API and seed only. Admin UI for categories is not built yet               |
| Capacity tracking against subscriptions                                             | ⬜     | —                                                          | —                                                       | Needs orders (Phase 6)                                                    |

### Phase 4 verification log (2026-11-09)

- `npm test`: server 180/180, client 19/19. Lint, Prettier, production build and schema-drift check clean.
- Manual end-to-end run: as a Super Administrator, created a draft through the admin form, attached a key information PDF (through the same
  API the page uses), and confirmed that the Publish button was disabled with the four-eyes explanation (the server also returned 403). As a
  second Investment Manager (a local test account), published through the UI, which created v1 and locked the terms. Signed out: the
  product appeared on `/investments` with category counts. The detail page showed terms, the risk disclosure, documents and eligibility
  ("sign in", "open for subscription", sandbox notice). The calculator returned GH₵ 1,321.36 on GH₵ 10,000 at 26.5% for 182 days, which
  matches a hand calculation.
- Fixed during the run: the risk label and issuer overlapped on product cards.

## Phase 5: Financial foundation

| Requirement                                                                | Status | Files                                                                 | Tests                                         | Notes                                                                                     |
| -------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Chart of accounts                                                          | ✅     | `src/db/seed.js` (`CHART_OF_ACCOUNTS`)                                | `ledger.test.js`                              | 14 system accounts × 3 currencies; customer accounts on demand; accountant review pending |
| Double-entry journal entries and lines                                     | ✅     | `modules/ledger/ledger.service.js`, migration `20261109150000_ledger` | `ledger.test.js`                              | Balanced per currency (service and deferred DB trigger)                                   |
| Immutable posting, reversal entries                                        | ✅     | DB triggers, `ledger.reverse`                                         | `ledger.test.js`                              | Exact-reversal trigger; one reversal per entry                                            |
| Wallet accounts and balances derived from the ledger                       | ✅     | `modules/wallet/wallet.service.js`, `WalletPage.jsx`                  | `ledger.test.js`, `adjustments.test.js`       | Trigger-maintained balance cache, read-only to code                                       |
| No negative customer balances and no double spending                       | ✅     | posting trigger + sorted `FOR UPDATE`                                 | `ledger.test.js` (10 concurrent reservations) | Exactly 6 of 10 succeed                                                                   |
| Idempotency (ledger keys + HTTP Idempotency-Key)                           | ✅     | `ledger.service.js`, `middleware/idempotency.js`                      | `ledger.test.js`, `adjustments.test.js`       | Replay, reuse detection, concurrent duplicate                                             |
| Transaction state machines                                                 | ✅     | `utils/state-machine.js`                                              | `state-machine.test.js`                       | Deposit, withdrawal, investment-order machines ready for Phase 6                          |
| Maker-checker manual adjustments                                           | ✅     | `adjustments.service.js`, `LedgerPage.jsx`                            | `adjustments.test.js`                         | Finance Officer requests, a second person approves                                        |
| Financial reconciliation                                                   | ✅     | `reconciliation.service.js`, worker job                               | `ledger.test.js`                              | 5 integrity checks; tamper detection proven; immutable runs                               |
| Wallet freeze (compliance)                                                 | ✅     | `wallet.service.js#setStatus`, `UserWalletCard.jsx`                   | `adjustments.test.js`, `ledger.test.js`       | Frozen wallets refuse reservations                                                        |
| Admin ledger console (trial balance, journal, adjustments, reconciliation) | ✅     | `LedgerPage.jsx`                                                      | manual run                                    |                                                                                           |
| Provider reconciliation                                                    | ⬜     | —                                                                     | —                                             | See Phase 6: settlement-file reconciliation not started                                   |

### Phase 5 verification log (2026-11-09)

- `npm test`: server 209/209, client 21/21. Lint, Prettier, production build and schema-drift check clean.
- Manual end-to-end run at phone width (253 px): a Finance Officer (local test account) requested a GH₵ 2,000.00 sandbox credit for the
  test investor. The Super Administrator reviewed and approved it, and journal entry #1 (3900 Dr / 2000 Cr) appeared. The trial
  balance showed "Balanced", and a reconciliation run from the UI passed (1 entry, 44 accounts). The investor's wallet showed
  GH₵ 2,000.00 available with the activity line.
- Fixed during the run:
  - every table and tab bar widened the page on narrow screens (the visually hidden `<caption>` escaped its scroll container); the wrappers now use `position: relative`
  - a migration bug in the balance-check trigger (bigint/uuid `COALESCE`) was fixed in a follow-up migration
  - route error boundaries were added, including a "new version available, reload" screen for stale code chunks

## Phase 6: Payments and investment engine

| Requirement                                                              | Status | Files                                                            | Tests                                                | Notes                                                                                  |
| ------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Payment provider adapter interface                                       | ✅     | `integrations/payments/*.provider.js`, `container.js`            | `payments.test.js`, `paystack.test.js`               | initialize / verify / payout / parseWebhook                                            |
| Sandbox provider (hosted checkout, signed webhooks, payouts)             | ✅     | `sandbox.provider.js`, `SandboxCheckoutPage.jsx`                 | `payments.test.js`, browser run                      | Payouts to numbers ending `0000` fail on purpose                                       |
| Paystack adapter (collections)                                           | 🟡     | `paystack.provider.js`                                           | `paystack.test.js` (mocked HTTP)                     | Never run against Paystack's sandbox: no test key available. Transfers not implemented |
| Flutterwave adapter                                                      | ⬜     | —                                                                | —                                                    | Not started                                                                            |
| Webhooks: signature check, replay safety, body not trusted               | ✅     | `deposits.service.js#handleWebhook`, `payment_webhook_events`    | `payments.test.js`                                   | HMAC-SHA512, unique event id, provider re-verification                                 |
| Deposits with provider re-verification                                   | ✅     | `deposits.service.js`, `DepositPage.jsx`                         | `payments.test.js`                                   | Amount mismatch fails and is audited; concurrent settlement is safe                    |
| Lost-webhook recovery                                                    | ✅     | `?refresh=1`, `pending-payments` job                             | `payments.test.js`                                   | Every 5 min                                                                            |
| Withdrawals with review (risk flags, approve/reject/cancel/retry/return) | ✅     | `withdrawals.service.js`, `WithdrawPage.jsx`, `PaymentsPage.jsx` | `payments.test.js`, `payments.test.jsx`, browser run | Funds held in 2100 from request; destination encrypted                                 |
| Investment order state machine                                           | ✅     | `orders.service.js`, `InvestPanel.jsx`, `OrdersPage.jsx`         | `orders.test.js`, browser run                        | Server re-checks all eligibility rules                                                 |
| Suitability acknowledgement                                              | ✅     | `orders.service.js#place`, `InvestPanel.jsx`                     | `orders.test.js`                                     | Recorded on the order and shown to staff                                               |
| Capacity under concurrency                                               | ✅     | `FOR UPDATE` on product                                          | `orders.test.js`                                     | No oversubscription                                                                    |
| Allocations and holdings                                                 | ✅     | `investment_allocations` (append-only), `investment_holdings`    | `orders.test.js`                                     | Custodian reference required                                                           |
| Maturity flagging and settlement with actual proceeds                    | ✅     | `maturity-flag` job, `orders.service.js#settleMaturity`          | `orders.test.js`                                     | Management fee from the snapshotted terms                                              |
| Investor screens (deposit, withdraw, transactions, my investments)       | ✅     | `pages/app/*`                                                    | `payments.test.jsx`, browser run                     |                                                                                        |
| Provider settlement reconciliation                                       | ⬜     | —                                                                | —                                                    | Only per-transaction re-verification today                                             |
| Refunds and chargebacks                                                  | ⬜     | —                                                                | —                                                    | `REVERSED` state exists, no workflow                                                   |
| Live providers                                                           | 🔒     | —                                                                | —                                                    | Needs licensing, provider contracts and the go-live gate                               |

### Phase 6 verification log (2026-11-10)

- `npm test`: server 241/241, client 23/23. Lint, Prettier and the production build are clean, and the schema has no drift.
- Manual end-to-end run at phone width (253 px), using local test accounts:
  - **Deposit:** the investor deposited GH₵ 1,500.00 through the sandbox checkout, and the status page showed "Received".
  - **Withdrawal:** the investor requested GH₵ 200.00 to MTN mobile money. The Finance Officer saw it in the review queue
    flagged "New destination" and "Deposit in last 24h", then approved it, and the status became "Sent".
  - **Order:** the investor placed a GH₵ 1,000.00 order on the sandbox 182-day bill and confirmed the terms in the dialog. The
    Investment Manager confirmed it with a custodian reference, and the order became Active.
  - **Ledger:** afterwards it netted to zero in every currency. The investor's available balance was GH₵ 2,300.00, and the
    reserved balance was 0.
- Fixed during the run:
  - the account menu button had no accessible name on phones
  - the risk meter and the marketplace grid overflowed on screens narrower than 320 px

## Phase 7: Investor experience

| Requirement                                                                                                                  | Status | Files                                                                       | Tests                                                                  | Notes                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Investor dashboard (value, wallet, invested, returns, counts, allocation, maturities, activity, verification, notifications) | ✅     | `portfolio.service.js#dashboard`, `DashboardPage.jsx`                       | `investor-experience.test.js`, browser run                             | Every figure from ledger and holding records                                              |
| Valuation methods (estimated accrual, at cost, realized), clearly labelled                                                   | ✅     | `portfolio.service.js#valueHolding`                                         | `investor-experience.test.js` (exact rounding)                         | No market price feed, so nothing is marked to market                                      |
| Historical valuations and performance chart                                                                                  | ✅     | `portfolio.service.js#history`, `charts.jsx`                                | `investor-experience.test.js`                                          | Rebuilt per date from records; table view; brand colour validated                         |
| Analytics: cash flows, fees, realized/unrealized, risk exposure, date filter                                                 | ✅     | `portfolio.service.js#analytics`, `MyInvestmentsPage.jsx`                   | `investor-experience.test.js`, browser run                             | Period ≤ 1 year                                                                           |
| Statements and reports (PDF/CSV), confirmations, receipts                                                                    | ✅     | `statements.service.js`, `utils/pdf.js`, `StatementsPage.jsx`               | `investor-experience.test.js`, `pdf.test.js`, browser run (PDF opened) | Built-in PDF writer, CSV formula-injection guard                                          |
| Document versioning, private storage, signed short-lived URLs, access logs                                                   | ✅     | `generated_documents`, `generated_document_access`                          | `investor-experience.test.js`                                          | Append-only; separate signing key from KYC links                                          |
| In-app notifications, unread count, mark read                                                                                | ✅     | `notifications.service.js`, `NotificationsPage.jsx`, `NotificationBell.jsx` | `investor-experience.test.js`                                          | Written in the same transaction as the event                                              |
| Notification preferences (email/SMS/in-app per category)                                                                     | ✅     | `messaging.service.js#queue`, `templates.js#TEMPLATE_META`                  | `investor-experience.test.js`, `portfolio.test.jsx`                    | Security and account email cannot be switched off                                         |
| Delivery tracking and retries                                                                                                | ✅     | `outbound_messages`, `redispatchStale`                                      | existing `queue.test.js`                                               | `FAILED` after 10 attempts                                                                |
| Push notifications                                                                                                           | ⬜     | —                                                                           | —                                                                      | No push provider                                                                          |
| Referral codes, links, attribution, dashboard, history                                                                       | ✅     | `referrals.service.js`, `ReferralsPage.jsx`, `RegisterPage.jsx`             | `investor-experience.test.js`, `portfolio.test.jsx`                    | Attribution fixed at sign-up (DB trigger)                                                 |
| Referral campaigns, eligibility, payouts, anti-abuse                                                                         | ✅     | `referrals.service.js`, `ReferralsAdminPage.jsx`                            | `investor-experience.test.js`                                          | Four-eyes activation (DB check); flagged referrals held for review; ledger-backed payouts |
| Support tickets: categories, priorities, statuses, assignment, conversations, attachments, internal notes                    | ✅     | `support.service.js`, `SupportPage.jsx`, `SupportDeskPage.jsx`              | `investor-experience.test.js`, browser run                             | Agents never see balances or identity documents                                           |
| Complaint handling and resolution tracking                                                                                   | ✅     | `support_tickets_complaint_resolution` check                                | `investor-experience.test.js`                                          | Resolution required before resolve/close                                                  |
| Support performance report                                                                                                   | ✅     | `support.service.js#report`                                                 | `investor-experience.test.js`                                          | First response, resolution time, complaints, per agent                                    |
| FAQ management and public help centre                                                                                        | ✅     | `SupportDeskPage.jsx` (FAQ tab), `HelpPage.jsx`                             | `investor-experience.test.js`                                          | Only published entries are public                                                         |
| Tax documents, signed investor agreements                                                                                    | ⬜     | —                                                                           | —                                                                      | Need tax and legal input                                                                  |

### Phase 7 verification log (2026-11-10)

- `npm test`: server 261/261, client 26/26. Lint, Prettier and the production build are clean, and the schema has no drift.
- Manual run with the local test accounts:
  - **Dashboard:** total value GH₵ 3,300.00 = GH₵ 2,300.00 wallet + GH₵ 1,000.00 holding. This matches the Phase 6 ledger
    check. The value chart, allocation, maturity (182 days), recent activity and the notification bell all showed.
  - **Portfolio:** the 26.5% target-return bill is shown "At cost", as designed. Monthly cash flows matched the ledger.
  - **Statement:** a portfolio statement PDF was generated, stored, listed under Documents and opened. Its figures match
    the dashboard.
  - **Support:** the investor opened request #1 and got the in-app acknowledgement. The admin saw it in the queue and
    replied. Status became "Awaiting customer", the first response time was recorded, and the ticket was auto-assigned.
  - **Referrals:** the page showed the code and link, with "no campaign running".
  - **Phone width (375 px):** no horizontal overflow on the dashboard, portfolio, documents, notifications, support and
    help pages.
- Fixed during the run:
  - the referral link widened the page on phones
  - allocation labels were truncated in narrow cards
  - staff landing on `/app` are now sent to the back office
- Test bugs fixed during development: an over-broad assertion (test emails start with `kyc-`), and a wrong expected
  status (409 is correct for reopening a closed ticket).

## Phase 8: Administration

| Requirement                                                                                                          | Status | Files                                                                                  | Tests                                      | Notes                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Admin overview (users, investors, money, investments, approvals, compliance and transaction alerts, recent activity) | ✅     | `overview.service.js`, `OverviewPage.jsx`                                              | `administration.test.js`, browser run      | Each section gated by permission                                                   |
| Generic maker-checker approvals                                                                                      | ✅     | `approvals.service.js`, `ApprovalsPage.jsx`, `approval_requests`                       | `administration.test.js`                   | Requester ≠ decider (DB); stale requests FAIL instead of applying; 7-day expiry    |
| System configuration via approved settings                                                                           | ✅     | `settings.registry.js`, `settings.service.js`, `settings.admin.js`, `SettingsPage.jsx` | `administration.test.js`, `admin.test.jsx` | Typed, validated, cross-checked; payment limits and fee read from settings         |
| Maintenance mode                                                                                                     | ✅     | `middleware/maintenance.js`, `SandboxBanner.jsx`                                       | `administration.test.js`                   | Pauses investor money movements only                                               |
| Content management (site announcement, FAQ)                                                                          | ✅     | `platform.announcement` setting, FAQ (Phase 7)                                         | `administration.test.js`                   |                                                                                    |
| Approval for granting Super Administrator / Administrator                                                            | ✅     | `access.service.js#assignRole`                                                         | `administration.test.js`                   | Checker also needs `roles:manage`                                                  |
| Transaction monitoring (rules → alerts)                                                                              | ✅     | `monitoring.service.js`                                                                | `administration.test.js`                   | Large deposit, amount mismatch, risky withdrawal, pass-through. Alerts never block |
| Compliance case management (timeline, escalation, risk classification, wallet freeze, regulatory report reference)   | ✅     | `compliance.service.js`, `CompliancePage.jsx`                                          | `administration.test.js`                   | Outcome required to close (DB); timeline append-only; no automatic filing          |
| Audit log viewer and export                                                                                          | ✅     | `records.service.js`, `AuditPage.jsx`                                                  | `administration.test.js`, browser run      | Export audited; up to 10,000 rows                                                  |
| Administrative reports (financial, investors, investments, journal) with CSV                                         | ✅     | `records.service.js`, `ReportsPage.jsx`                                                | `administration.test.js`, browser run      | ≤ 1 year per report                                                                |
| Notification management (delivery log, retry, template catalogue)                                                    | ✅     | `records.service.js`, `MessagesPage.jsx`                                               | `administration.test.js`                   | Recipients masked; bodies never shown; secret-bearing messages not re-sent         |
| User, investor, product, KYC, deposit, withdrawal, order, support, referral management                               | ✅     | earlier phases                                                                         | earlier tests                              | Consolidated in the admin navigation                                               |
| Record retention policies                                                                                            | ⬜     | —                                                                                      | —                                          | Records are undeletable; retention and archival need a legal decision (Phase 10)   |
| Regulatory report formats and filing                                                                                 | 🔒     | —                                                                                      | —                                          | Filed outside the system; reference recorded on the case                           |

### Phase 8 verification log (2026-11-10)

- `npm test`: server 274/274, client 28/28. Lint, Prettier and the production build are clean, and the schema has no drift.
- Manual run with the local super-admin test account:
  - **Overview:** GH₵ 2,300.00 customer money plus GH₵ 1,000.00 in investments. This matches the ledger checks from
    Phases 6–7. Deposits, withdrawals and recent activity matched the records.
  - **Settings:** an announcement change was proposed. It appeared as "Waiting for approval", and the requester could
    only withdraw it, not approve it. It was then withdrawn.
  - **Audit log:** showed `approval.requested` and `approval.cancelled` with before/after detail.
  - **Reports:** the financial summary showed GH₵ 1,500.00 deposited, GH₵ 200.00 withdrawn and GH₵ 1,000.00 invested.
  - **Messages:** 19 sent, with masked recipients.
  - **Compliance:** no alerts on the dev data, which is expected.
  - **Phone width (375 px):** no horizontal overflow on any of the new admin pages.
  - The second-person approval itself is covered by integration tests, not this browser run.
- Fixed during the run:
  - the audit filter buttons were cut off on medium screens
  - seeded settings wrongly showed "Last changed"

## Phase 9: Advanced capabilities

| Requirement                                                     | Status | Files                                                                              | Tests                           | Notes                                                                     |
| --------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| Currency configuration with approval                            | ✅     | `fx.service.js#proposeCurrencyStatus`, `FxPage.jsx`                                | `advanced.test.js`, browser run | Cannot deactivate while balances are held                                 |
| Exchange-rate integration (adapter, timestamps)                 | 🟡     | `integrations/fx/sandbox.fx.js`, `exchange_rates`                                  | `advanced.test.js`              | Sandbox provider only: fixed illustrative rates. Live provider 🔒         |
| Conversion records and currency-specific ledgers                | ✅     | `fx.service.js`, `ConvertPage.jsx`                                                 | `advanced.test.js`, browser run | Exact fraction math; entry balances per currency; quotes single-use, 60 s |
| Currency reconciliation                                         | ✅     | `fx.service.js#positions`                                                          | `advanced.test.js`              | FX clearing vs conversions, per currency                                  |
| Subscriptions: renewal rules, status, cancellation, history     | ✅     | `orders.service.js#setRollover`, `#rolloverAfterMaturity`, `MyInvestmentsPage.jsx` | `advanced.test.js`, browser run | Consent tied to terms version; never reinvests under changed terms        |
| Configurable tax rules with approval                            | ✅     | `tax.service.js`, `TaxRulesPage.jsx`                                               | `advanced.test.js`              | No rule built in                                                          |
| Tax statements                                                  | ✅     | `statements.service.js#TAX_STATEMENT`                                              | `advanced.test.js`              | Estimates only; nothing withheld                                          |
| Tax withholding and remittance                                  | 🔒     | —                                                                                  | —                               | Needs legal basis and tax-authority arrangements                          |
| Fraud: suspicious login, referral abuse alerts, velocity checks | ✅     | `monitoring.service.js`                                                            | `advanced.test.js`              | Velocity and unusual withdrawals from Phases 6 and 8                      |
| Risk scoring                                                    | ✅     | `insights.service.js#riskScore`, `RiskScoreCard.jsx`                               | `advanced.test.js`              | Explainable, ranks for review, never blocks                               |
| Concentration monitoring and product-level limits               | ✅     | `insights.service.js#concentration`, `InsightsPage.jsx`                            | `advanced.test.js`              | Flags above a configurable threshold                                      |
| Portfolio risk metrics                                          | ✅     | `portfolio.service.js#riskMetrics`                                                 | `advanced.test.js`              | Weighted risk, high-risk share, largest holding                           |
| Automatic exposure limits                                       | ⬜     | —                                                                                  | —                               | Needs a risk policy                                                       |
| Fee schedules and fee reports                                   | ✅     | `insights.service.js#feeSchedule`, Financial summary report                        | `advanced.test.js`              | Platform fees via approved settings; product fees per version             |
| Commission rules                                                | ⬜     | —                                                                                  | —                               | No distributors yet                                                       |
| Business intelligence (funnel, monthly KPIs)                    | ✅     | `insights.service.js#kpis`, `InsightsPage.jsx`                                     | `advanced.test.js`, browser run | Per currency                                                              |

### Phase 9 verification log (2026-11-13)

- `npm test`: server 283/283, client 28/28. Lint, Prettier and the production build are clean, and the schema has no drift.
- One unexplained failure: during development, one full-suite run failed the Phase 7 dashboard test once. It did not
  recur in three later full runs or when run alone, and no cause was found.
- Manual run with the local test accounts:
  - **Currency activation:** the Finance Officer requested USD activation, and the Super Administrator approved it on
    the Approvals page. This is the first second-person approval exercised end to end in the browser.
  - **Conversion:** the investor got a quote for GH₵ 310.00: fee GH₵ 4.65 (1.5%), receiving US$ 19.70 at the sandbox
    rate of 15.5. After converting, the GHS wallet went from 2,300.00 to 1,990.00 and a separate USD wallet showed
    19.70.
  - **Rollover:** reinvest at maturity was switched on for the active holding, with the risk disclosure tick.
  - **Insights:** the funnel and monthly KPIs matched the ledger (November: 1,500 in, 200 out, 1,000 invested).
- Environment problems during the run (not application bugs):
  - Postgres needed crash recovery after an unclean machine restart, which took longer than the start script waited.
    The script now waits up to five minutes.
  - The API's file watcher restarted in a loop, so the API was run without watch mode.
  - Two sign-ins failed while the database was still slow (a 5-second transaction limit).
- Fixed during the run:
  - the top-risk list could miss recent users (it took an unordered first 200)
  - the rates card on the convert page showed a stale timestamp after a quote refreshed the rate

## Phase 10: Hardening and production readiness

Assessment: [production-readiness.md](production-readiness.md).

| Requirement                                | Status      | Implementation                                                       | Tests                   | Notes                                                                    |
| ------------------------------------------ | ----------- | -------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| Playwright E2E suite                       | ✅          | `e2e/` (public pages, money journey)                                 | 20 passed, 1 skipped    | Against the production build and a real API; desktop and mobile projects |
| Route-wide authorization and CSRF sweep    | ✅          | `tests/integration/security-sweep.test.js`                           | sweep                   | Every discovered route checked                                           |
| Concurrency and idempotency critical paths | ✅          | `tests/integration/critical-paths.test.js`                           | racing tests            | FX quote race, withdrawal race, duplicate keys, expiry, reconciliation   |
| Coverage thresholds                        | ✅          | `server/vitest.config.js`                                            | `npm run test:coverage` | 87% statements, 74% branches, 87% functions, 91% lines                   |
| Security review                            | ✅ internal | `.dockerignore`, heavy limiter, live-mode gates, dependency override | `go-live.test.js`       | ZAP scan and external pen test not done                                  |
| Performance                                | ✅          | `scripts/perf-smoke.js`, overview cache, 15 s transaction timeout    | `npm run perf:smoke`    | All p95 under 500 ms locally                                             |
| Migration verification                     | ✅          | CI migrate + drift check                                             | drift check             | One unused index reverted after measurement                              |
| Backup restore drill                       | ✅          | `infrastructure/backup/restore-drill.mjs`                            | `npm run backup:drill`  | Passed 6/6 on dev and test DBs                                           |
| Observability: metrics                     | ✅          | `middleware/metrics.js`                                              | `metrics.test.js`       | Token-protected Prometheus endpoint                                      |
| CI/CD                                      | 🟡          | `.github/workflows/ci.yml` (verify, e2e, images)                     | —                       | Not run on GitHub yet (no remote). No deploy jobs (no cloud target)      |
| Staging deployment                         | ⬜          | —                                                                    | —                       | No hosting, registry or Docker available here                            |
| Error tracking service                     | ⬜          | —                                                                    | —                       | Vendor not chosen                                                        |
| Record retention                           | ⬜          | —                                                                    | —                       | Needs a legal decision                                                   |
| `ENCRYPTION_KEY` rotation                  | ⬜          | —                                                                    | —                       | Re-encryption job not built                                              |

### Phase 10 verification log (2026-11-14)

- Server 299/299 (final run; one earlier run lost its DB connection during a local disk stall, see testing.md). Coverage
  above thresholds. Client 28/28. Lint, Prettier and the production build are clean.
- Playwright: 20 passed, 1 skipped (mobile project runs the public pages only). One setup flake: a 15 s
  transaction timeout right after a coverage run; it passed on re-run.
- `npm run perf:smoke`: every endpoint p95 under 500 ms after adding the 10 s admin-overview cache (it had been slowest).
- `npm run backup:drill`: passed on `mynx_dev` and `mynx_test`. A tampered backup was rejected.
- `npm ci` from the lockfile and `npm audit --omit=dev` (0 vulnerabilities). Prisma validate, migrate and generate
  work with the overridden `deepmerge-ts`.
- Found and fixed: secrets would have entered images; go-live gate not enforced; sandbox providers allowed in live
  mode; non-writable storage in the container; the monitoring-alert test depended on pagination; the metrics route
  label lost its mount prefix.
- Not done: staging deployment, Docker image builds (no Docker here), first CI run on GitHub, ZAP scan, pen test.

## External prerequisites (cannot be completed in code)

- 🔒 Licensing and regulatory approval for the target market (for Ghana, the
  SEC Ghana licence category that matches the business model).
- 🔒 Payment provider merchant accounts and live API keys.
- 🔒 Custody or trustee arrangements for investor assets.
- 🔒 KYC/AML and sanctions screening vendor contracts.
- 🔒 Legal review of Terms, Privacy Policy and Risk Disclosures.
- 🔒 Accountant review of the chart of accounts and posting rules.
