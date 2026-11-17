# Environment configuration

All configuration comes from environment variables, validated at start-up by `server/src/config/env.js`. The process
refuses to start on an invalid value, so a misconfiguration fails loudly instead of running unsafely. Copy
`.env.example` to `server/.env` for development. In staging and production, supply variables from the platform's
secrets manager; never from files in the image (the `.dockerignore` excludes them).

## Core

| Variable        | Default                  | Notes                                                                                                       |
| --------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`      | `development`            | `development`, `test`, `staging`, `production`                                                              |
| `PORT`          | `4000`                   | API port                                                                                                    |
| `LOG_LEVEL`     | `info`                   | Pino level                                                                                                  |
| `DATABASE_URL`  | (required)               | PostgreSQL URL. Add `connection_limit=` sized for the instance (Prisma's default is 2 × CPUs + 1)           |
| `REDIS_URL`     | `redis://127.0.0.1:6379` | Queues and shared rate limits                                                                               |
| `ENABLE_QUEUES` |                          | `true` in deployed environments: the worker delivers messages and runs scheduled jobs                       |
| `QUEUE_PREFIX`  | `mynx`                   | Separates environments sharing one Redis                                                                    |
| `APP_BASE_URL`  | `http://localhost:5173`  | Public URL of the web app (links in emails, checkout return)                                                |
| `CORS_ORIGINS`  | (required)               | Comma-separated list. No wildcards; `https` only in production                                              |
| `TRUST_PROXY`   | `0`                      | Number of proxies in front (for client IPs in logs, limits and audit)                                       |
| `METRICS_TOKEN` | (unset)                  | Bearer token for `GET /api/v1/health/metrics` (Prometheus text format). The endpoint returns 404 when unset |
| `PLATFORM_MODE` | `sandbox`                | `live` only with `NODE_ENV=production`, real providers and an approved go-live (see below)                  |

## Secrets

| Variable                 | Rule                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SESSION_SECRET`         | At least 32 characters. Placeholder values are refused in production                                                                                                                                   |
| `ENCRYPTION_KEY`         | 32 bytes, base64. Encrypts KYC documents, identity numbers, MFA secrets, payout destinations and stored files. **Losing it makes those unreadable; rotating it needs a re-encryption job (not built)** |
| `BACKUP_ENCRYPTION_KEY`  | 32 bytes, base64, for the restore drill and backups. Must differ from `ENCRYPTION_KEY` in production, and be stored separately from the backups                                                        |
| `PAYSTACK_SECRET_KEY`    | Only with `PAYMENT_PROVIDER=paystack`. `sk_live_` keys are refused outside live mode                                                                                                                   |
| `SANDBOX_WEBHOOK_SECRET` | Optional (sandbox). Derived from `SESSION_SECRET` when unset                                                                                                                                           |

Generate keys with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Security limits

| Variable                                           | Default      | Notes                                                                                                  |
| -------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`           | 60 000 / 300 | Global, per IP                                                                                         |
| `AUTH_RATE_LIMIT_WINDOW_MS`, `AUTH_RATE_LIMIT_MAX` | 15 min / 20  | Sign-in, registration and recovery, per IP                                                             |
| `HEAVY_RATE_LIMIT_MAX`                             | 30           | Per signed-in user per minute: statements, uploads, support messages, FX quotes, audit export, reports |
| `LOCKOUT_THRESHOLD`, `LOCKOUT_MINUTES`             | 5 / 15       | Account lockout after failed passwords                                                                 |
| `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`   | 30 / 12      | Session lifetime                                                                                       |
| `UPLOAD_MAX_BYTES`                                 | 10 MB        | KYC and support attachments                                                                            |
| `DOCUMENT_URL_TTL_SECONDS`                         | 300          | Lifetime of signed download links                                                                      |

## Providers

Each provider is an adapter. Today only sandbox adapters exist, except payments, which also have Paystack collections.

| Variable                              | Values today                 | Live requirement                                                           |
| ------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `PAYMENT_PROVIDER`                    | `sandbox`, `paystack`        | Live Paystack account, plus a transfers (payout) adapter that is not built |
| `EMAIL_PROVIDER`, `SMS_PROVIDER`      | `sandbox` (stored, not sent) | A real email and SMS adapter. Live mode refuses `sandbox`                  |
| `SCREENING_PROVIDER`                  | `sandbox`                    | A contracted sanctions/PEP screening adapter. Live mode refuses `sandbox`  |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR` | `local`, `storage/private`   | A persistent encrypted volume, or an object-storage driver (not built)     |
| Exchange rates                        | sandbox provider (in code)   | A live rate source and an FX licence or banking partner                    |

## Payment and money defaults

`DEPOSIT_MIN_MINOR`, `DEPOSIT_MAX_MINOR`, `WITHDRAWAL_MIN_MINOR`, `WITHDRAWAL_FEE_MINOR` and `LARGE_WITHDRAWAL_MINOR` are
deployment defaults in minor units (pesewas). Once running, these and the other business settings are changed in the
admin console, **System settings**, with a second approver. An approved value overrides the environment default.

## Going live

Live mode is blocked twice:

1. **Configuration:** with `PLATFORM_MODE=live`, start-up fails while email, SMS or screening use sandbox adapters, or
   payments use the sandbox provider.
2. **Start-up:** the API and the worker refuse to start in live mode unless the `platform.go_live_approved` system
   setting is `true`. That setting cannot be changed from the console; an operator sets it after every item in
   [production-readiness.md](production-readiness.md) is signed off.
