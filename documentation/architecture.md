# Architecture

Mynx is an investment platform built as a **modular monolith**: one deployable
Express API, one background worker process, one React SPA, PostgreSQL and Redis.

> **Operating mode.** The platform runs in **sandbox mode** by default. No
> real-money operations are enabled. Live payments, custody and investment
> products require legal, regulatory, provider and operational prerequisites
> (see `documentation/security.md` → "Go-live gate"). The `PLATFORM_MODE`
> setting is `sandbox` unless explicitly changed, and the UI shows a persistent
> sandbox banner.

## 1. High-level topology

```
 Browser (React SPA, Vite build served by Nginx)
        │  HTTPS, same-site cookies, /api/v1/*
        ▼
 Nginx (TLS termination, static assets, reverse proxy)
        │
        ▼
 Express API (server/src/server.js)          BullMQ Worker (server/src/worker.js)
   ├─ middleware: request-id, helmet,          ├─ notification delivery
   │  CORS allowlist, rate limit, auth,        ├─ payment reconciliation
   │  RBAC, validation, error handling         ├─ maturity processing
   └─ modules/* (routes → controllers          └─ scheduled jobs, DLQ
        → services → repositories)
        │                                        │
        ├──────────── PostgreSQL ◄───────────────┤
        └──────────── Redis (queues, rate-limit) ┘
```

## 2. Backend layering

Each module in `server/src/modules/<name>/` follows the same shape:

| File                   | Responsibility                                                     |
| ---------------------- | ------------------------------------------------------------------ |
| `<name>.routes.js`     | URL → middleware chain (auth, permission, validation) → controller |
| `<name>.controller.js` | Translate HTTP ↔ service calls. No business logic.                 |
| `<name>.service.js`    | Business rules, transactions, state machines, audit calls          |
| `<name>.repository.js` | Prisma queries where they are reused or complex                    |
| `<name>.schemas.js`    | Zod request schemas                                                |

Rules:

- Controllers never touch Prisma directly.
- Financial logic (ledger, wallet, investment engine, payments) lives only in
  services and receives an explicit Prisma transaction client (`tx`) so that
  multiple steps commit atomically.
- Cross-module calls go through the other module's **service**, never its
  repository, so boundaries can later be extracted.
- HTTP concerns (status codes, cookies) never leak into services. Services throw
  `AppError` subclasses. The error middleware maps them to the standard error
  envelope.

## 3. Module boundaries

| Module           | Owns (tables)                                                      | Depends on                           |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------ |
| auth             | sessions, tokens, MFA, login attempts                              | users, notifications, audit          |
| users            | users, profiles, roles, permissions                                | audit                                |
| onboarding / kyc | investor profiles, KYC applications, documents, risk assessment    | documents, compliance, notifications |
| investments      | products, categories, orders, allocations, holdings                | ledger, wallet, compliance, fees     |
| portfolio        | portfolios, valuations (read models)                               | investments, ledger                  |
| wallet           | wallets, wallet accounts (views over ledger)                       | ledger                               |
| payments         | payments, deposits, withdrawals, webhook events, provider adapters | ledger, wallet, fraud                |
| ledger           | ledger accounts, journal entries, journal lines                    | none (core)                          |
| transactions     | the user-facing transaction feed                                   | ledger, payments                     |
| analytics        | report queries, exports                                            | read-only access to everything       |
| notifications    | notifications, preferences, templates, deliveries                  | queue                                |
| referrals        | codes, referrals, rewards                                          | ledger, fraud                        |
| documents        | document metadata, versions, access log                            | object storage                       |
| support          | tickets, messages, FAQs                                            | notifications                        |
| admin            | approval requests (maker-checker), settings                        | everything (through services)        |
| compliance       | cases, screening results, AML flags                                | kyc, payments                        |
| fraud            | fraud alerts, risk scores, velocity checks                         | auth, payments, referrals            |

**The ledger is the only source of truth for money.** Wallet balances are derived
from posted journal lines on ledger accounts. No endpoint can set a balance.

## 4. Frontend architecture

```
client/src/
  components/ui/      design-system primitives (Button, Input, Table, Modal…)
  layouts/            PublicLayout, InvestorLayout, AdminLayout
  pages/              route-level screens grouped by area (public/, app/, admin/)
  features/           feature-scoped hooks + components (auth, wallet…)
  services/           api client (fetch wrapper, error normalisation)
  hooks/              shared hooks
  context/            app-wide providers (toasts, auth session)
  routes/             route tree
  utils/              formatting (money from minor units, dates)
  styles/             Tailwind entry + design tokens
```

- Server state: TanStack Query. No financial value is computed in the browser.
  Money arrives from the API as strings in minor units with a currency code and is
  only _formatted_ on the client.
- Forms: React Hook Form + Zod, with schemas mirroring the server's.
- Three layouts with separate navigation: public website, investor app, admin
  app. The admin app is code-split and permission-gated on the server. Hiding
  routes in the client is a UX nicety, not a security control.

## 5. Money representation

- Amounts are stored as **integer minor units** in `BIGINT` columns
  (`amount_minor`), paired with an ISO 4217 `currency` code. Each currency
  stores its `minorUnits` exponent (GHS = 2, USD = 2, JPY = 0).
- Rates, percentages and unit prices use `NUMERIC(28,10)` (Prisma `Decimal`).
- Arithmetic in JS uses `BigInt` (see `server/src/utils/money.js`). Conversions
  that need division use an explicit rounding mode (`HALF_EVEN` by default for
  accounting, configurable per operation).
- Amounts cross the API boundary as **strings** (`"125000"`) so JSON numbers never
  lose precision.
- Balances in different currencies are never summed together. Cross-currency
  totals always go through a recorded `ExchangeRate` with its timestamp, and
  are labelled as estimates.

## 6. Key architectural decisions (ADR summary)

| #   | Decision                                                                                | Rationale                                                                               | Reversible?                 |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------- |
| 1   | Modular monolith                                                                        | One team and one deploy keep it simple. Clear boundaries still allow later extraction.  | Yes                         |
| 2   | Server-side sessions (opaque token in an httpOnly cookie, hashed in DB) instead of JWT  | Instant revocation, device history, no token-in-JS. Refresh-token complexity goes away. | Yes                         |
| 3   | Integer minor units for money                                                           | Exact arithmetic, no float errors                                                       | Costly; chosen deliberately |
| 4   | Double-entry ledger with immutable posted journals (DB triggers block UPDATE/DELETE)    | Auditability, financial integrity                                                       | No (by design)              |
| 5   | Prisma 6 with SQL migrations, plus raw SQL for triggers and check constraints           | Typed client plus DB-level guarantees                                                   | Yes                         |
| 6   | BullMQ on Redis for async work, with idempotent job IDs                                 | Retry and DLQ semantics                                                                 | Yes                         |
| 7   | Provider-adapter interface for payments, KYC, email, SMS, FX                            | Sandbox by default, swap providers per market                                           | Yes                         |
| 8   | Sandbox mode default, with a go-live gate in settings that needs maker-checker approval | Prevents accidental real-money operation                                                | Yes                         |
| 9   | Express 5 (native async error propagation)                                              | Fewer try/catch wrappers                                                                | Yes                         |

## 7. Financial and security risk register

| Risk                                              | Mitigation (phase)                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Double spend / race on balance reservation        | `SELECT … FOR UPDATE` on wallet ledger accounts inside a serializable or repeatable-read tx. Idempotency keys. Unique constraints on external references. (P5–P6)                    |
| Duplicate payment webhook credits a deposit twice | Store each webhook event with a unique (provider, eventId). Credit only on the state transition `pending → succeeded`, checked in-tx. Re-verify with the provider API. (P6)          |
| Unbalanced journals                               | Service-level check plus a deferred DB constraint trigger that rejects a posted entry whose lines don't sum to zero per currency. (P5)                                               |
| Admin silently edits balances / deletes history   | No balance columns are writable. Ledger and audit tables are append-only via triggers. Adjustments need maker-checker `ApprovalRequest`. (P1 audit trigger, P5 ledger, P8 approvals) |
| Floating-point errors                             | BigInt minor units with an ESLint rule that bans `parseFloat` in financial modules. Tests cover it. (P1)                                                                             |
| Account takeover                                  | Argon2id, MFA (TOTP), lockout, rate limits, session revocation, login alerts (P2)                                                                                                    |
| IDOR on documents or KYC files                    | Ownership checks in services, private storage, short-lived signed URLs, access audit (P3, P7)                                                                                        |
| Support agent sees financial data                 | Permission-scoped serializers. Support role lacks `wallet:read:any`. (P2, P7)                                                                                                        |
| Secrets in logs                                   | Pino redaction paths for auth headers, cookies, passwords, tokens, documents (P1)                                                                                                    |
| Misrepresenting sandbox as real money             | Persistent sandbox banner, `PLATFORM_MODE` gate, provider adapters refuse live keys while in sandbox (P1, P6)                                                                        |
| Fabricated performance data                       | Products may only show historical performance with a sourced `PerformanceRecord`. Calculator outputs say "illustrative, not guaranteed". (P4)                                        |
| CSRF on cookie auth                               | SameSite=Lax cookies, plus a double-submit CSRF token on state-changing requests, plus a CORS allowlist (P2)                                                                         |

## 8. Dependencies

**Runtime (server):** express 5, helmet, cors, express-rate-limit, cookie-parser,
pino / pino-http, zod, @prisma/client, ioredis, bullmq, argon2 (P2), otplib (P2).

**Runtime (client):** react 19, react-dom, react-router 7, @tanstack/react-query 5,
react-hook-form, @hookform/resolvers, zod, recharts, lucide-react, tailwindcss 4.

**Dev / test:** vite, vitest, supertest, @playwright/test (P2+), eslint 9,
prettier, prisma CLI.

**Infrastructure:** PostgreSQL 16+ (dev box runs 18), Redis 7 (or the
Memurai-compatible equivalent on Windows), Docker / Compose, Nginx.

## 9. Local development topology

Two supported ways to run dependencies:

1. **Docker Compose** (`docker compose up -d postgres redis`): recommended.
2. **No Docker** (this dev machine): `npm run db:local:init && npm run db:local:start`
   creates a project-local PostgreSQL cluster in `.devdata/pg` on port 5433
   using the installed PostgreSQL binaries, without admin rights. Redis comes
   from any local Redis-compatible server on 6379.
