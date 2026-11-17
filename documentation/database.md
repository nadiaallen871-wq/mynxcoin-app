# Database

PostgreSQL with Prisma 6. The schema is in `server/prisma/schema.prisma`, and migrations are in `server/prisma/migrations/`.

## Conventions

- snake_case tables and columns. UUID primary keys (`gen_random_uuid()`), except `audit_logs`, which uses a BIGSERIAL for ordering.
- `created_at` / `updated_at` are `timestamptz`.
- **Money:** `BIGINT` minor units in `*_minor` columns plus a `CHAR(3)` currency that references `currencies.code`. Rates use `NUMERIC(28,10)`.
- Invariants are enforced **in the database** wherever possible (CHECK constraints, unique constraints, triggers), not only in services.
- Every schema change ships as a migration. Raw SQL (triggers, checks) is appended to the generated migration file.
- Tests apply pending migrations to `mynx_test` (non-destructive `migrate deploy`). CI applies every migration to a fresh database and checks for schema drift.

## Phase 1 tables

| Table                                                    | Purpose                                         | Notable constraints                                                            |
| -------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `users`                                                  | Account identity (auth fields added in Phase 2) | unique `email`                                                                 |
| `roles`, `permissions`, `role_permissions`, `user_roles` | RBAC                                            | system roles flagged `is_system`; permission deletion restricted while granted |
| `audit_logs`                                             | Append-only audit trail                         | trigger rejects UPDATE, DELETE and TRUNCATE                                    |
| `currencies`                                             | ISO 4217 config                                 | `code ~ '^[A-Z]{3}$'`, `minor_units BETWEEN 0 AND 4`                           |
| `system_settings`                                        | Versioned platform config                       | changes audited; sensitive keys need approval (Phase 8)                        |

## Phase 2 tables

| Table                 | Purpose                                                                                         | Notable constraints                        |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `user_profiles`       | Name, organisation, country                                                                     | 1:1 with users; ISO country check          |
| `user_sessions`       | Server-side sessions (HMAC of the cookie token)                                                 | unique `token_hash`; expiry after creation |
| `mfa_configurations`  | Encrypted TOTP secret, enabled flag, last used step                                             | 1:1 with users                             |
| `recovery_codes`      | HMACs of single-use MFA recovery codes                                                          | unique `code_hash`                         |
| `verification_tokens` | Email verification, phone codes, password reset, staff account setup (one table, `type` column) | unique `token_hash`; expiry after creation |
| `login_attempts`      | Every sign-in attempt with a reason code                                                        | indexed by email, user and IP              |
| `outbound_messages`   | Transactional email/SMS outbox                                                                  | indexed by status                          |

`PasswordResetToken` from the original entity list is the `PASSWORD_RESET` type in `verification_tokens`. One table keeps
single-use semantics, hashing and expiry in one place.

## Phase 3 tables

| Table                  | Purpose                                                                     | Notable constraints                                                                             |
| ---------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `investor_profiles`    | KYC data per user; outcome (`kyc_status`, `risk_rating`, `kyc_verified_at`) | ID number encrypted; country-code checks; verified-at iff APPROVED; PEP needs details           |
| `risk_assessments`     | Questionnaire results                                                       | append-only; score 0–100                                                                        |
| `kyc_applications`     | One case per review cycle                                                   | one open application per user (partial unique index); decision fields required for final states |
| `kyc_review_events`    | State-change history                                                        | append-only                                                                                     |
| `screening_results`    | Sanctions/PEP results per submission                                        | append-only                                                                                     |
| `investor_documents`   | Document metadata (file in encrypted storage)                               | unique storage key; SHA-256 check; submitted documents cannot be deleted                        |
| `document_access_logs` | Upload / URL / download / removal log                                       | append-only                                                                                     |

`KYCCase` from the original entity list is covered by `kyc_applications` together with `kyc_review_events`. Broader compliance cases
(AML alerts, escalations) are `monitoring_alerts` and `compliance_cases` (Phase 8).

## Phase 4 tables

| Table                   | Purpose                            | Notable constraints                                                                                                                |
| ----------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `investment_categories` | Marketplace categories (5 seeded)  | slug format                                                                                                                        |
| `investment_products`   | Product terms and lifecycle        | amount/rate/fee ranges; rate iff return type ≠ NONE; risk 1–7; window order; no STAFF eligibility; published ⇒ version + publisher |
| `product_documents`     | Product PDFs (encrypted storage)   | SHA-256 check                                                                                                                      |
| `performance_records`   | Sourced historical returns         | append-only; source required; period order; unique per period                                                                      |
| `product_versions`      | Immutable snapshot per publication | append-only; unique (product, version)                                                                                             |

## Phase 5 tables

| Table                     | Purpose                                             | Notable constraints                                                                                                                                          |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ledger_accounts`         | Chart of accounts plus per-customer wallet accounts | partial unique indexes (system per purpose+currency; customer per purpose+currency+owner); customer accounts never negative; identity immutable; undeletable |
| `ledger_account_balances` | Trigger-maintained running balance                  | writes only from triggers (`pg_trigger_depth`)                                                                                                               |
| `journal_entries`         | Posted entries                                      | unique idempotency key and entry number; one reversal per entry; immutable; ≥ 2 lines (deferred)                                                             |
| `journal_lines`           | Signed amounts (debit +)                            | non-zero; currency = account currency; balanced per currency (deferred); immutable                                                                           |
| `wallets`                 | Wallet status (active/frozen) per user and currency | unique (user, currency); no balance column                                                                                                                   |
| `ledger_adjustments`      | Maker-checker manual adjustments                    | positive amount; decider ≠ requester; approved ⇒ journal entry                                                                                               |
| `idempotency_keys`        | Stored HTTP responses for financial POSTs           | unique (user, key); 24 h expiry                                                                                                                              |
| `reconciliation_runs`     | Integrity check results                             | append-only                                                                                                                                                  |

## Phase 6 tables

| Table                           | Purpose                                           | Notable constraints                                                    |
| ------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `payments`                      | Provider transactions (inbound and outbound)      | unique reference; positive amount                                      |
| `payment_webhook_events`        | Every received webhook                            | unique (provider, event id); undeletable                               |
| `sandbox_provider_transactions` | The sandbox provider's own records (sandbox only) | unique reference                                                       |
| `deposits`                      | Deposit lifecycle                                 | succeeded ⇔ ledger entry (`deposits_ledger_link`)                      |
| `withdrawals`                   | Withdrawal lifecycle                              | encrypted destination; request entry required; returned ⇒ return entry |
| `investment_orders`             | Order lifecycle with product-terms snapshot       | confirmed ⇒ confirm entry; cancelled/rejected ⇒ release entry          |
| `investment_allocations`        | Custodian or issuer allocation per order          | append-only; one per order                                             |
| `investment_holdings`           | Position per confirmed order                      | matured ⇒ proceeds and settlement entry                                |

## Phase 7 tables

| Table                       | Purpose                                      | Notable constraints                                               |
| --------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `notifications`             | In-app notification centre                   | indexed by user and unread                                        |
| `notification_preferences`  | Channel choices per category                 | primary key (user, category)                                      |
| `referral_codes`            | One code per user                            | unique code, `^[A-Z0-9]{6,16}$`                                   |
| `referral_campaigns`        | Reward rules                                 | inactive until approved; approver ≠ creator; positive reward      |
| `referrals`                 | Attribution and status                       | referrer ≠ referred; attribution immutable (trigger); undeletable |
| `referral_rewards`          | Payout records                               | append-only; unique per referral; linked to a journal entry       |
| `support_tickets`           | Requests and complaints                      | complaint resolved ⇒ resolution; assignee ≠ customer              |
| `support_messages`          | Conversation and internal notes              | append-only                                                       |
| `support_attachments`       | Encrypted attachments                        | append-only                                                       |
| `faqs`                      | Help centre content                          |                                                                   |
| `generated_documents`       | Statements, reports, confirmations, receipts | append-only; unique (user, kind, format, scope, version)          |
| `generated_document_access` | Generation, URL issue and download log       | append-only                                                       |

## Phase 8 tables

| Table                    | Purpose                                                          | Notable constraints                                                                                 |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `approval_requests`      | Maker-checker requests (setting changes, privileged role grants) | decider ≠ requester; decided ⇔ decider and time; reason ≥ 10 characters; undeletable                |
| `monitoring_alerts`      | Transaction-monitoring alerts                                    | unique dedupe key per rule and record; escalated ⇒ case; undeletable                                |
| `compliance_cases`       | AML, sanctions, PEP, fraud and KYC cases                         | closed ⇔ closed time and an outcome of ≥ 10 characters; report reference ⇔ report time; undeletable |
| `compliance_case_events` | Case timeline                                                    | append-only                                                                                         |

## Phase 9 tables

| Table                  | Purpose                                   | Notable constraints                                                |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `exchange_rates`       | Rate snapshots (value of one unit in GHS) | append-only; rate > 0                                              |
| `fx_quotes`            | Priced conversion offers                  | different currencies; fee < amount; spread 0–1000 bps; undeletable |
| `currency_conversions` | Executed conversions                      | append-only; one per quote; linked to a journal entry              |
| `tax_rules`            | Configurable tax rules                    | 0 ≤ rate < 1; approver ≠ creator; undeletable                      |

`investment_holdings` gains the rollover columns (`rollover`, `rollover_version`, `rollover_consent_at`,
`rollover_order_id`, `rollover_note`); rollover requires recorded consent (check).

## Planned model by phase

| Phase | Entities                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------- |
| 2     | UserProfile, UserSession, MFAConfiguration, RecoveryCode, VerificationToken, PasswordResetToken, LoginAttempt |
| 3     | InvestorProfile, KYCApplication, KYCCase, InvestorDocument, RiskAssessment, ScreeningResult                   |
| 4     | InvestmentCategory, InvestmentProduct, ProductDocument, PerformanceRecord (sourced only)                      |
| 5     | LedgerAccount, JournalEntry, JournalLine, Wallet, WalletAccount, IdempotencyKey, Reconciliation               |

Ledger invariants and enforcement are documented in [financial-ledger.md](financial-ledger.md).
