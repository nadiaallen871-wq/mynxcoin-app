# Mynx investment platform

A modular-monolith investment platform: **React (Vite) + Express 5 + PostgreSQL + Prisma + Redis/BullMQ**, all in JavaScript.

> ⚠️ **Sandbox only.** No real money, payments or investments are processed. Live operation requires the
> regulatory, provider, custody and legal prerequisites listed in
> [documentation/implementation-checklist.md](documentation/implementation-checklist.md#external-prerequisites-cannot-be-completed-in-code).

## Status

**All 10 phases are complete in sandbox mode.** The platform is ready for a sandbox staging deployment, which has not been done yet: there is no hosting account. It is **not** ready for real money. See the
[production readiness assessment](documentation/production-readiness.md) and the
[requirements traceability matrix](documentation/implementation-checklist.md).

## Repository layout

```
client/            React SPA (Vite, Tailwind v4, React Router 7, TanStack Query)
server/            Express API + BullMQ worker, Prisma schema and migrations
  src/config/      env validation, logger, permission catalogue
  src/middleware/  request id, security, validation, errors
  src/modules/     feature modules (routes → controllers → services)
  src/jobs/        queues, worker factory, processors
  src/utils/       money (BigInt minor units), errors
  tests/           unit + integration (real Postgres and Redis)
infrastructure/    Dockerfiles, Nginx, local Postgres helper
documentation/     architecture, database, security, ledger, deployment…
```

## Prerequisites

- Node.js ≥ 20.19 (developed on 24)
- PostgreSQL 16+ and Redis 7 (or a compatible server such as Memurai on Windows),
  **or** Docker with Compose

## Quick start

```bash
npm install
cp .env.example server/.env          # then set SESSION_SECRET
```

Start the dependencies, **either** with Docker:

```bash
docker compose up -d postgres redis   # set DATABASE_URL to port 5432 in server/.env
```

**or** without Docker, using a project-local PostgreSQL cluster on port 5433 (no admin rights needed):

```bash
npm run db:local:init                 # first time: creates .devdata/pg, mynx_dev and mynx_test
npm run db:local:start                # afterwards
```

Local troubleshooting:

- **After an unclean shutdown** (power loss, forced restart), PostgreSQL runs crash recovery on the next start. This can
  take a few minutes; `db:local:start` waits up to five. Progress is in `.devdata/pg.log`.
- **If the API restarts in a loop** under `npm run dev:server` without you editing files, something on the machine is
  touching the watched files (for example a disk scan after a restart). Run it without watch mode instead:
  `node --env-file-if-exists=.env src/server.js` from `server/`.

Then:

```bash
npm run db:migrate                    # apply migrations to mynx_dev
npm run db:seed                       # roles, permissions, currencies, settings
npm run dev:server                    # API on http://localhost:4000
npm run dev:worker                    # background worker (separate terminal)
npm run dev:client                    # SPA on http://localhost:5173 (proxies /api)
```

Open http://localhost:5173/status to see live readiness of the database, Redis and the worker.

Create the first administrator (prints a single-use link to set the password):

```bash
npm run admin:bootstrap --workspace server -- --email you@example.com --first Ama --last Mensah
```

Development helpers:

- http://localhost:5173/dev/outbox: sandbox emails and SMS (verification links, reset links, phone codes)
- http://localhost:5173/dev/design-system: component catalogue

With `ENABLE_QUEUES=true` the worker delivers messages, so keep `npm run dev:worker` running.

## Testing

Server tests run against a real **test** database (`*_test` only: the setup refuses any other name). Pending
migrations are applied before each run (`prisma migrate deploy`). Copy `server/.env.test.example` to `server/.env.test` to get started. To wipe the local test DB, run
`npx prisma migrate reset` in `server/` yourself. Copy `server/.env.test` from the values in `.env.example`, pointing
`DATABASE_URL` at `mynx_test`.

```bash
npm test                                   # server + client
npm run test:coverage --workspace server   # server tests with coverage thresholds
npm run test:e2e                           # Playwright (first time: npx playwright install chromium)
npm run perf:smoke --workspace server      # p95 latency budget on hot endpoints
npm run backup:drill                       # encrypted backup, restore and ledger checks
npm run lint
npm run build
```

See [testing.md](documentation/testing.md) for details.

## Documentation

| Doc                                                                      | Contents                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [architecture.md](documentation/architecture.md)                         | topology, layering, module boundaries, ADRs, risk register                  |
| [implementation-checklist.md](documentation/implementation-checklist.md) | phase plan and traceability matrix                                          |
| [database.md](documentation/database.md)                                 | schema conventions, current tables, planned model                           |
| [api.md](documentation/api.md)                                           | conventions and endpoint inventory                                          |
| [authentication.md](documentation/authentication.md)                     | sessions, CSRF, passwords, MFA, lockout, RBAC, staff onboarding             |
| [kyc-onboarding.md](documentation/kyc-onboarding.md)                     | investor onboarding, documents, review workflow, screening                  |
| [marketplace.md](documentation/marketplace.md)                           | catalogue, eligibility, calculator, product lifecycle                       |
| [security.md](documentation/security.md)                                 | controls, OWASP ASVS mapping, go-live gate                                  |
| [financial-ledger.md](documentation/financial-ledger.md)                 | double-entry ledger, wallets, idempotency, adjustments, reconciliation      |
| [payments.md](documentation/payments.md)                                 | sandbox provider, webhooks, deposits, withdrawals, orders, maturities       |
| [investor-experience.md](documentation/investor-experience.md)           | dashboard, valuation, statements, notifications, referrals, support         |
| [administration.md](documentation/administration.md)                     | overview, approvals, settings, monitoring, compliance cases, audit, reports |
| [advanced-capabilities.md](documentation/advanced-capabilities.md)       | multi-currency, rollover, tax, fraud scoring, risk, fees, BI                |
| [deployment.md](documentation/deployment.md)                             | environments, Docker, CI/CD, backups                                        |
| [environment.md](documentation/environment.md)                           | every environment variable, secrets, providers, live gates                  |
| [testing.md](documentation/testing.md)                                   | test layers, commands, test databases, CI                                   |
| [production-readiness.md](documentation/production-readiness.md)         | acceptance criteria, security review, performance, go-live checklist        |
| [admin-guide.md](documentation/admin-guide.md)                           | back-office guide for staff                                                 |
| [investor-guide.md](documentation/investor-guide.md)                     | guide for investors                                                         |
