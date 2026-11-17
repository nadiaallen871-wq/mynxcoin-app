import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Prepares the TEST database and creates fresh accounts for this run:
 *  - a verified investor (KYC approved, risk questionnaire done, no MFA)
 *  - a Finance Officer with MFA enrolled (the TOTP secret is written for the tests)
 * Accounts are created through the same API flows the server tests use.
 */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('E2E tests only run against a *_test database (server/.env.test)');
  const server = join(import.meta.dirname, '..', 'server');
  execSync('npx prisma migrate deploy', { cwd: server, stdio: 'inherit', env: process.env });

  const { prisma } = await import('../server/src/db/prisma.js');
  const { seed } = await import('../server/src/db/seed.js');
  const { verifiedInvestor } = await import('../server/tests/payment-helpers.js');
  const { createStaffClient, PASSWORD } = await import('../server/tests/auth-helpers.js');
  const { buildTestApp } = await import('../server/tests/helpers.js');
  try {
    await seed(prisma);
    await prisma.systemSetting.updateMany({ where: { key: 'platform.maintenance_mode' }, data: { value: false } });
    const app = buildTestApp({ prisma });
    const investor = await verifiedInvestor(app, { firstName: 'Esi', lastName: 'Browser' });
    const finance = await createStaffClient(['FINANCE_OFFICER'], app);
    const dir = join(import.meta.dirname, '.auth');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'accounts.json'),
      JSON.stringify(
        { password: PASSWORD, investor: { email: investor.email }, finance: { email: finance.email, mfaSecret: finance.secret } },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}
