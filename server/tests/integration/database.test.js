import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { assertNoConflicts, seed } from '../../src/db/seed.js';
import { createAuditService } from '../../src/modules/audit/audit.service.js';
import { CONFLICTING_PERMISSIONS, PERMISSIONS, ROLES } from '../../src/config/permissions.js';

const audit = createAuditService({ prisma });

beforeAll(async () => {
  await seed(prisma);
});
afterAll(() => prisma.$disconnect());

describe('migrations and seed', () => {
  it('seeds every permission and the ten system roles', async () => {
    expect(await prisma.permission.count()).toBe(Object.keys(PERMISSIONS).length);
    const roles = await prisma.role.findMany({ where: { isSystem: true } });
    expect(roles.map((r) => r.key).sort()).toEqual(Object.keys(ROLES).sort());
    expect(roles).toHaveLength(10);
  });

  it('is idempotent and preserves operator-changed settings', async () => {
    await prisma.systemSetting.update({ where: { key: 'platform.maintenance_mode' }, data: { value: true } });
    await seed(prisma);
    await seed(prisma);
    expect(await prisma.permission.count()).toBe(Object.keys(PERMISSIONS).length);
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'platform.maintenance_mode' } });
    expect(setting.value).toBe(true);
    await prisma.systemSetting.update({ where: { key: 'platform.maintenance_mode' }, data: { value: false } });
  });

  it('enforces separation of duties in default role grants', async () => {
    expect(() => assertNoConflicts()).not.toThrow();
    for (const [a, b] of CONFLICTING_PERMISSIONS) {
      const holders = await prisma.role.findMany({
        where: { AND: [{ permissions: { some: { permission: { key: a } } } }, { permissions: { some: { permission: { key: b } } } }] },
      });
      expect(holders, `${a} + ${b}`).toHaveLength(0);
    }
    expect(() => assertNoConflicts({ BAD: { permissions: ['ledger:adjustment:initiate', 'ledger:adjustment:approve'] } })).toThrow(
      /separation of duties/,
    );
  });

  it('keeps support agents away from financial and identity data', async () => {
    const support = await prisma.role.findUnique({
      where: { key: 'SUPPORT_AGENT' },
      include: { permissions: { include: { permission: true } } },
    });
    const keys = support.permissions.map((p) => p.permission.key);
    expect(keys.some((k) => /^(wallet|ledger|kyc|deposits|withdrawals)/.test(k))).toBe(false);
  });

  it('enforces currency check constraints', async () => {
    await expect(prisma.currency.create({ data: { code: 'zz1', name: 'Bad', symbol: '?', minorUnits: 2 } })).rejects.toThrow();
    await expect(prisma.currency.create({ data: { code: 'ZZZ', name: 'Bad', symbol: '?', minorUnits: 9 } })).rejects.toThrow();
  });
});

describe('audit log is append-only', () => {
  it('records scrubbed entries', async () => {
    const row = await audit.record({
      action: 'test.event',
      entityType: 'test',
      entityId: 'e1',
      after: { password: 'p', amountMinor: 5n },
      requestId: 'req-1',
    });
    expect(row.after).toEqual({ password: '[REDACTED]', amountMinor: '5' });
  });

  it('rejects UPDATE at the database level', async () => {
    const row = await audit.record({ action: 'test.update', entityType: 'test' });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
  });

  it('rejects DELETE and TRUNCATE at the database level', async () => {
    const row = await audit.record({ action: 'test.delete', entityType: 'test' });
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it('rolls back with the surrounding transaction', async () => {
    const before = await prisma.auditLog.count();
    await expect(
      prisma.$transaction(async (tx) => {
        await audit.record({ action: 'test.rollback', entityType: 'test' }, tx);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await prisma.auditLog.count()).toBe(before);
  });
});
