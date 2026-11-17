#!/usr/bin/env node
/**
 * Backup and restore drill. A backup only counts once a restore from it has worked.
 *
 *   node infrastructure/backup/restore-drill.mjs            # uses server/.env (DATABASE_URL)
 *   DATABASE_URL=... BACKUP_ENCRYPTION_KEY=... node infrastructure/backup/restore-drill.mjs
 *
 * Steps:
 *  1. pg_dump -Fc of the source database.
 *  2. Encrypt the dump with AES-256-GCM (BACKUP_ENCRYPTION_KEY, 32 bytes base64; falls back to
 *     the app ENCRYPTION_KEY for local drills only). Only the encrypted file is kept.
 *  3. Decrypt it, restore into a fresh scratch database on the same server.
 *  4. Verify: migrations recorded, row counts of every table equal the source, every journal
 *     entry balances per currency, cached balances equal their lines, the trial balance is
 *     zero per currency, and no customer account is negative.
 *  5. Drop the scratch database and write a JSON report to .devdata/drills/.
 *
 * Exits non-zero if any step or check fails. Read-only on the source database.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..', '..');
const require = createRequire(join(root, 'server', 'package.json'));
const { PrismaClient } = require('@prisma/client');

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
}
const env = { ...loadEnvFile(join(root, 'server', '.env')), ...process.env };

function pgBin() {
  if (env.PG_BIN) return env.PG_BIN;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump'], { encoding: 'utf8' });
  if (which.status === 0) return resolve(which.stdout.split(/\r?\n/)[0], '..');
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\PostgreSQL';
    if (existsSync(base))
      for (const v of readdirSync(base).sort().reverse()) if (existsSync(join(base, v, 'bin', 'pg_dump.exe'))) return join(base, v, 'bin');
  }
  throw new Error('pg_dump not found. Set PG_BIN to the PostgreSQL bin directory.');
}
const tool = (name) => join(pgBin(), process.platform === 'win32' ? `${name}.exe` : name);

function keyBytes() {
  const raw = env.BACKUP_ENCRYPTION_KEY ?? env.ENCRYPTION_KEY;
  if (!raw) throw new Error('Set BACKUP_ENCRYPTION_KEY (32 bytes, base64)');
  if (!env.BACKUP_ENCRYPTION_KEY && env.NODE_ENV === 'production')
    throw new Error('Production drills need a dedicated BACKUP_ENCRYPTION_KEY');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

// File format: "MYNXBK1" | iv(12) | tag(16) | ciphertext
function encrypt(plain, key) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from('MYNXBK1'), iv, c.getAuthTag(), body]);
}
function decrypt(blob, key) {
  if (blob.subarray(0, 7).toString() !== 'MYNXBK1') throw new Error('Not a Mynx encrypted backup');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(7, 19));
  d.setAuthTag(blob.subarray(19, 35));
  return Buffer.concat([d.update(blob.subarray(35)), d.final()]);
}

const sourceUrl = new URL(env.DATABASE_URL);
const scratchName = `${sourceUrl.pathname.slice(1)}_restore_drill`;
if (!/^[a-z0-9_]+$/.test(scratchName)) throw new Error('Unexpected database name');
const scratchUrl = new URL(sourceUrl);
scratchUrl.pathname = `/${scratchName}`;
const pgEnv = { ...process.env, PGPASSWORD: decodeURIComponent(sourceUrl.password) };
const conn = ['-h', sourceUrl.hostname, '-p', sourceUrl.port || '5432', '-U', decodeURIComponent(sourceUrl.username)];

const workDir = join(root, '.devdata', 'drills');
mkdirSync(workDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const report = {
  startedAt: new Date().toISOString(),
  source: sourceUrl.pathname.slice(1),
  scratch: scratchName,
  steps: [],
  checks: [],
  status: 'FAILED',
};
const step = async (name, fn) => {
  const t = Date.now();
  const out = await fn();
  report.steps.push({ name, ms: Date.now() - t });
  return out;
};

const ledgerChecks = async (db) => ({
  unbalancedEntries: Number(
    (
      await db.$queryRaw`SELECT COUNT(*)::int AS n FROM (SELECT entry_id, currency FROM journal_lines GROUP BY 1, 2 HAVING SUM(amount_minor) <> 0) x`
    )[0].n,
  ),
  cacheMismatches: Number(
    (
      await db.$queryRaw`SELECT COUNT(*)::int AS n FROM ledger_account_balances b
        LEFT JOIN (SELECT account_id, SUM(amount_minor) s FROM journal_lines GROUP BY 1) l ON l.account_id = b.account_id
        WHERE b.balance_minor <> COALESCE(l.s, 0)`
    )[0].n,
  ),
  nonZeroTrialBalances: Number(
    (
      await db.$queryRaw`SELECT COUNT(*)::int AS n FROM (SELECT a.currency FROM ledger_accounts a JOIN ledger_account_balances b ON b.account_id = a.id GROUP BY 1 HAVING SUM(b.balance_minor) <> 0) x`
    )[0].n,
  ),
  negativeCustomerAccounts: Number(
    (
      await db.$queryRaw`SELECT COUNT(*)::int AS n FROM ledger_accounts a JOIN ledger_account_balances b ON b.account_id = a.id WHERE a.owner_user_id IS NOT NULL AND b.balance_minor > 0 AND a.purpose IN ('CUSTOMER_AVAILABLE','CUSTOMER_RESERVED')`
    )[0].n,
  ),
});
const rowCounts = async (db) => {
  const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const counts = {};
  for (const { tablename } of tables)
    counts[tablename] = Number((await db.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS n FROM "${tablename}"`))[0].n);
  return counts;
};

const dumpFile = join(workDir, `${stamp}.dump`);
const encFile = join(workDir, `${stamp}.dump.enc`);
let source;
let scratch;
try {
  const key = keyBytes();
  source = new PrismaClient({ datasourceUrl: sourceUrl.toString() });
  const sourceState = await step('snapshot source counts and ledger', async () => ({
    counts: await rowCounts(source),
    ledger: await ledgerChecks(source),
  }));

  await step('pg_dump (custom format)', () =>
    execFileSync(tool('pg_dump'), [...conn, '-Fc', '-f', dumpFile, sourceUrl.pathname.slice(1)], { env: pgEnv, stdio: 'pipe' }),
  );
  const plain = readFileSync(dumpFile);
  report.dumpSha256 = createHash('sha256').update(plain).digest('hex');
  await step('encrypt (AES-256-GCM)', () => writeFileSync(encFile, encrypt(plain, key)));
  rmSync(dumpFile); // only the encrypted copy is kept
  report.encryptedBytes = statSync(encFile).size;

  const restored = await step('decrypt', () => decrypt(readFileSync(encFile), key));
  if (createHash('sha256').update(restored).digest('hex') !== report.dumpSha256)
    throw new Error('Decrypted dump does not match the original');
  const restoredFile = join(workDir, `${stamp}.restore.dump`);
  writeFileSync(restoredFile, restored);

  await step('create scratch database', () => {
    execFileSync(tool('dropdb'), [...conn, '--if-exists', scratchName], { env: pgEnv, stdio: 'pipe' });
    execFileSync(tool('createdb'), [...conn, scratchName], { env: pgEnv, stdio: 'pipe' });
  });
  await step('pg_restore', () =>
    execFileSync(tool('pg_restore'), [...conn, '-d', scratchName, '--no-owner', '--exit-on-error', restoredFile], {
      env: pgEnv,
      stdio: 'pipe',
    }),
  );
  rmSync(restoredFile);

  scratch = new PrismaClient({ datasourceUrl: scratchUrl.toString() });
  const after = { counts: await rowCounts(scratch), ledger: await ledgerChecks(scratch) };
  const migrations = Number(
    (await scratch.$queryRaw`SELECT COUNT(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`)[0].n,
  );

  const check = (name, ok, detail) => report.checks.push({ name, ok, ...(detail ? { detail } : {}) });
  const diff = Object.keys(sourceState.counts).filter((t) => sourceState.counts[t] !== after.counts[t]);
  check(
    'every table has the same row count',
    diff.length === 0,
    diff.length ? diff.map((t) => `${t}: ${sourceState.counts[t]} → ${after.counts[t]}`) : `${Object.keys(after.counts).length} tables`,
  );
  check('migrations are recorded', migrations > 0, `${migrations} applied`);
  check('every journal entry balances per currency', after.ledger.unbalancedEntries === 0);
  check('cached balances equal their journal lines', after.ledger.cacheMismatches === 0);
  check('trial balance is zero in every currency', after.ledger.nonZeroTrialBalances === 0);
  check('no customer account is negative', after.ledger.negativeCustomerAccounts === 0);
  report.status = report.checks.every((c) => c.ok) ? 'PASSED' : 'FAILED';
} catch (err) {
  report.error = String(err.stderr ?? err.message ?? err).slice(0, 2000);
} finally {
  await scratch?.$disconnect();
  await source?.$disconnect();
  try {
    execFileSync(tool('dropdb'), [...conn, '--if-exists', scratchName], { env: pgEnv, stdio: 'pipe' });
    report.steps.push({ name: 'drop scratch database', ms: 0 });
  } catch {
    report.cleanupWarning = `Could not drop ${scratchName}; drop it manually.`;
  }
  if (existsSync(dumpFile)) rmSync(dumpFile);
  report.finishedAt = new Date().toISOString();
  const out = join(workDir, `${stamp}-report.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`Restore drill ${report.status}: ${report.checks.filter((c) => c.ok).length}/${report.checks.length} checks passed`);
  for (const c of report.checks)
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` (${Array.isArray(c.detail) ? c.detail.join('; ') : c.detail})` : ''}`);
  if (report.error) console.log(`  error: ${report.error}`);
  console.log(`Report: ${out}\nEncrypted backup kept: ${existsSync(encFile) ? encFile : 'none'}`);
  process.exitCode = report.status === 'PASSED' ? 0 : 1;
}
