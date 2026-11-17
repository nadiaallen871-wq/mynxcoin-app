# Deployment, environments and recovery

## Environments

| Env         | Purpose                                       | Data                               | Payments                      |
| ----------- | --------------------------------------------- | ---------------------------------- | ----------------------------- |
| development | local work                                    | synthetic only                     | provider sandbox              |
| test        | automated tests (`*_test` DB, reset each run) | synthetic                          | none / mocks                  |
| staging     | pre-release verification, production-like     | synthetic, never production copies | provider sandbox              |
| production  | live                                          | real                               | live (after the go-live gate) |

Each environment has its own database, Redis, secrets and provider credentials. Production credentials never leave the
production secrets manager.

## Running with Docker Compose

```bash
cp server/.env.docker.example server/.env.docker   # set SESSION_SECRET
docker compose --profile app up -d --build
# SPA + API via Nginx: http://localhost:8080
```

The `migrate` service runs `prisma migrate deploy` and the seed before `api` and `worker` start.

> Not yet verified: Docker isn't installed on the development machine, so the images and the Compose stack have never
> been built or run here. CI now builds both images (`images` job), but that job has not run yet.

Image notes (Phase 10):

- `.dockerignore` keeps `.env*` files, document storage, test suites, coverage output and `.git` out of the build context.
- The API image runs as the non-root `mynx` user. `/app/server/storage` is owned by that user and declared as a
  `VOLUME`: mount a persistent, encrypted volume there (or add an object-storage driver).
- `HEALTHCHECK` calls `/api/v1/health`. Use `/api/v1/health/ready` (database and Redis) for load-balancer readiness.
- **Metrics:** set `METRICS_TOKEN` and scrape `GET /api/v1/health/metrics` with `Authorization: Bearer <token>`. The
  endpoint is 404 without the token. Counters are per process, so scrape every instance.

## CI/CD

`.github/workflows/ci.yml` runs on pushes to `main`, on pull requests, and weekly:

- **verify:**
  - lint, format check, migrations on a fresh Postgres, schema-drift check
  - server tests with coverage thresholds; client tests and build
  - performance smoke test (p95 ≤ 500 ms), backup restore drill, `npm audit`
- **e2e:** the Playwright suite against the production build.
- **images:** builds both Dockerfiles without pushing them.

**The Phase 10 jobs have not run on GitHub yet.** The repository has no remote, so expect fixes on the first run.

Deployment jobs are not written. Building and pushing images, the staging deploy and the manual production approval
need a registry and a cloud target, which haven't been chosen.

## Scaling notes

- The API is stateless. Scale horizontally behind a load balancer. Before running more than one instance, switch the rate
  limiter to a Redis store (P2).
- Workers scale independently. Jobs are idempotent by job ID.
- Redis must use `maxmemory-policy noeviction`, as BullMQ requires.
- `audit_logs` grows fastest. Searching it by action prefix scans in primary-key order, which is fine at current volume.
  Past a few million rows, require a date range or partition the table by month.
- The admin overview is cached for 10 seconds per process.

## Backups and disaster recovery (targets: RPO ≤ 5 min, RTO ≤ 1 h)

1. **Continuous WAL archiving plus daily base backups** (managed Postgres PITR, or pgBackRest/WAL-G on self-hosted),
   encrypted at rest (AES-256) and stored in a separate account or region.
2. **Retention:** 35 days PITR, plus monthly snapshots kept for 7 years (financial records). Confirm the period against local regulation.
3. **Logical dumps** (`pg_dump -Fc`) nightly as a second, independent copy.
4. **A backup only counts once a restore has worked.** Run a monthly automated restore drill: restore into an isolated
   instance, run `prisma migrate status`, row-count checks and the ledger balance check (Σ lines = 0 per currency),
   then record the result. A failed drill pages on-call.
5. **Runbook:** declare incident → freeze writes (maintenance mode) → restore to a point in time → verify the ledger →
   reconcile with providers for the gap window → reopen.

### Restore drill (`npm run backup:drill`)

`infrastructure/backup/restore-drill.mjs` runs these steps end to end:

1. Back up with `pg_dump -Fc` and encrypt with AES-256-GCM using `BACKUP_ENCRYPTION_KEY`.
2. Decrypt the copy and check its SHA-256.
3. Restore into a scratch database (`<db>_restore_drill`).
4. Check that:
   - every table's row count matches the source
   - every migration is recorded
   - every journal entry balances per currency
   - the balance cache equals the sum of the ledger lines
   - the trial balance is zero
   - no customer account is negative
5. Drop the scratch database and write a JSON report to `.devdata/drills/`.

It exits non-zero on any failure. A tampered backup file fails decryption.

**Verified 2026-11-14:** passed 6 of 6 checks on `mynx_dev` and `mynx_test` locally. CI runs it on every push and weekly.
This proves logical backups restore. PITR, off-site copies and retention still need to be configured on the chosen
hosting, and the drill must then point at that infrastructure.
