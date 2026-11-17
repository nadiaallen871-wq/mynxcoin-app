/** Reusable user queries. */
export function createUsersRepository({ prisma }) {
  return {
    normalizeEmail: (email) =>
      String(email ?? '')
        .trim()
        .toLowerCase(),

    /** Union of permission keys across all of the user's roles. */
    async permissionKeys(userId, tx = prisma) {
      const rows = await tx.permission.findMany({
        where: { roles: { some: { role: { users: { some: { userId } } } } } },
        select: { key: true },
        orderBy: { key: 'asc' },
      });
      return rows.map((r) => r.key);
    },

    async roleKeys(userId, tx = prisma) {
      const rows = await tx.userRole.findMany({ where: { userId }, select: { role: { select: { key: true } } } });
      return rows.map((r) => r.role.key).sort();
    },
  };
}
