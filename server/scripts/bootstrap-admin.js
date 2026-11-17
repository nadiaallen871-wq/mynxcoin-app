/**
 * Creates the first Super Administrator (one-off, run by an operator):
 *
 *   npm run admin:bootstrap -- --email admin@example.com --first Ama --last Mensah
 *
 * No password is set or printed. The script prints a single-use account setup
 * link (valid 24 h). The operator opens it, chooses a password, then enrols MFA,
 * which is required before the admin console unlocks.
 *
 * It refuses to run if an active Super Administrator already exists. Further
 * staff are invited from the admin console.
 */
import { parseArgs } from 'node:util';
import { env, logger } from '../src/config/index.js';
import { prisma } from '../src/db/prisma.js';
import { createContainer } from '../src/container.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, first: { type: 'string' }, last: { type: 'string' } } });
if (!values.email || !values.first || !values.last) {
  console.error('Usage: npm run admin:bootstrap -- --email <email> --first <first name> --last <last name>');
  process.exit(1);
}

const { tokens, audit, users } = createContainer({ env, logger, prisma });
const email = users.normalizeEmail(values.email);

try {
  const existing = await prisma.userRole.count({
    where: { role: { key: 'SUPER_ADMIN' }, user: { status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } } },
  });
  if (existing > 0) throw new Error('A Super Administrator already exists. Invite further staff from the admin console.');
  const role = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' } });
  if (!role) throw new Error('Roles are not seeded. Run `npm run db:seed` first.');

  const raw = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        type: 'STAFF',
        status: 'PENDING_VERIFICATION',
        profile: { create: { firstName: values.first, lastName: values.last } },
        roles: { create: { roleId: role.id } },
      },
    });
    const issued = await tokens.issue(tx, { userId: user.id, type: 'ACCOUNT_SETUP', target: email });
    await audit.record({ action: 'admin.bootstrap_super_admin', entityType: 'user', entityId: user.id, after: { email } }, tx);
    return issued.raw;
  });

  console.log(`\nSuper Administrator created for ${email}.`);
  console.log('Open this single-use link within 24 hours to set the password (do not share it):\n');
  console.log(`  ${tokens.link('/reset-password', raw)}\n`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
