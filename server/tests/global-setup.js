import { execSync } from 'node:child_process';

/**
 * Applies pending migrations to the TEST database before the suite runs.
 * It is non-destructive (`migrate deploy`): tests are written to tolerate
 * existing rows (the seed is idempotent and the audit log is append-only).
 * Migration-from-scratch is verified in CI against a fresh database. To wipe
 * the local test DB, run `npx prisma migrate reset` yourself.
 *
 * It refuses to run against any database whose name does not end in "_test".
 */
export default function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set for tests (create server/.env.test)');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to migrate non-test database "${dbName}". Test databases must end with _test.`);
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
