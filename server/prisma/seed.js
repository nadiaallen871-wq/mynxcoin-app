import { PrismaClient } from '@prisma/client';
import { seed } from '../src/db/seed.js';

const prisma = new PrismaClient();

try {
  console.log('Seed complete', await seed(prisma));
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
