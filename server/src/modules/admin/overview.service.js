const DAY_MS = 86_400_000;
const amount = (minor, currency = 'GHS') => ({ amountMinor: (minor ?? 0n).toString(), currency });

/**
 * Back-office overview. Each section is computed only if the viewer holds the
 * permission for that area, so a support agent never receives financial totals.
 * Money totals come from ledger account balances and settled records, never from
 * request-time estimates.
 */
const CACHE_MS = 10_000;

export function createOverviewService({ prisma, approvals }) {
  // Short cache keyed by permission set: the page shows its as-of time, and ~25 queries per load
  // otherwise queue for database connections when several staff open it at once.
  const cache = new Map();

  async function balanceOf(purposes, currency, { owned = false } = {}) {
    const rows = await prisma.ledgerAccountBalance.aggregate({
      where: { account: { purpose: { in: purposes }, currency, ...(owned ? { ownerUserId: { not: null } } : {}) } },
      _sum: { balanceMinor: true },
    });
    return rows._sum.balanceMinor ?? 0n;
  }

  const sections = {
    async users() {
      const since = new Date(Date.now() - 30 * DAY_MS);
      const [byType, byStatus, newUsers] = await Promise.all([
        prisma.user.groupBy({ by: ['type'], _count: true }),
        prisma.user.groupBy({ by: ['status'], _count: true }),
        prisma.user.count({ where: { createdAt: { gte: since }, type: { not: 'STAFF' } } }),
      ]);
      const count = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r._count]));
      return { byType: count(byType, 'type'), byStatus: count(byStatus, 'status'), newInvestors30d: newUsers };
    },

    async kyc() {
      const rows = await prisma.investorProfile.groupBy({ by: ['kycStatus'], _count: true });
      const byStatus = Object.fromEntries(rows.map((r) => [r.kycStatus, r._count]));
      return { byStatus, awaitingReview: (byStatus.SUBMITTED ?? 0) + (byStatus.UNDER_REVIEW ?? 0) };
    },

    async money(currency) {
      const since = new Date(Date.now() - 30 * DAY_MS);
      const [dep30, depAll, wd30, wdAll, pendingWd, failedWd, failedDep7] = await Promise.all([
        prisma.deposit.aggregate({
          where: { currency, status: 'SUCCEEDED', completedAt: { gte: since } },
          _sum: { amountMinor: true },
          _count: true,
        }),
        prisma.deposit.aggregate({ where: { currency, status: 'SUCCEEDED' }, _sum: { amountMinor: true } }),
        prisma.withdrawal.aggregate({
          where: { currency, status: 'COMPLETED', completedAt: { gte: since } },
          _sum: { amountMinor: true },
          _count: true,
        }),
        prisma.withdrawal.aggregate({ where: { currency, status: 'COMPLETED' }, _sum: { amountMinor: true } }),
        prisma.withdrawal.aggregate({ where: { currency, status: 'REQUESTED' }, _sum: { amountMinor: true }, _count: true }),
        prisma.withdrawal.count({ where: { currency, status: 'FAILED' } }),
        prisma.deposit.count({ where: { currency, status: 'FAILED', createdAt: { gte: new Date(Date.now() - 7 * DAY_MS) } } }),
      ]);
      // Liabilities and income are credit-normal, so their debit-positive balances are negated.
      const [clientMoney, holdings, feeIncome] = await Promise.all([
        balanceOf(['CUSTOMER_AVAILABLE', 'CUSTOMER_RESERVED'], currency, { owned: true }),
        balanceOf(['CUSTOMER_HOLDINGS'], currency),
        balanceOf(['FEE_INCOME_MANAGEMENT', 'FEE_INCOME_TRANSACTION'], currency),
      ]);
      return {
        currency,
        deposits30d: { ...amount(dep30._sum.amountMinor, currency), count: dep30._count },
        depositsAllTime: amount(depAll._sum.amountMinor, currency),
        withdrawals30d: { ...amount(wd30._sum.amountMinor, currency), count: wd30._count },
        withdrawalsAllTime: amount(wdAll._sum.amountMinor, currency),
        pendingWithdrawals: { ...amount(pendingWd._sum.amountMinor, currency), count: pendingWd._count },
        customerWalletLiability: amount(-clientMoney, currency),
        customerHoldings: amount(-holdings, currency),
        feeIncome: amount(-feeIncome, currency),
        alerts: { failedPayouts: failedWd, failedDeposits7d: failedDep7 },
      };
    },

    async investments(currency) {
      const [pending, active, due, published] = await Promise.all([
        prisma.investmentOrder.aggregate({ where: { currency, status: 'PENDING' }, _sum: { amountMinor: true }, _count: true }),
        prisma.investmentHolding.aggregate({
          where: { currency, status: { in: ['ACTIVE', 'MATURITY_DUE'] } },
          _sum: { principalMinor: true },
          _count: true,
        }),
        prisma.investmentHolding.count({ where: { status: 'MATURITY_DUE' } }),
        prisma.investmentProduct.count({ where: { status: 'PUBLISHED' } }),
      ]);
      return {
        pendingOrders: { ...amount(pending._sum.amountMinor, currency), count: pending._count },
        activeHoldings: { ...amount(active._sum.principalMinor, currency), count: active._count },
        maturitiesDue: due,
        publishedProducts: published,
      };
    },

    async compliance() {
      const [alerts, cases] = await Promise.all([
        prisma.monitoringAlert.groupBy({ by: ['severity'], where: { status: 'OPEN' }, _count: true }),
        prisma.complianceCase.groupBy({
          by: ['status'],
          where: { status: { notIn: ['CLOSED_NO_ACTION', 'CLOSED_ACTION_TAKEN'] } },
          _count: true,
        }),
      ]);
      return {
        openAlerts: Object.fromEntries(alerts.map((a) => [a.severity, a._count])),
        openCases: cases.reduce((a, c) => a + c._count, 0),
        casesByStatus: Object.fromEntries(cases.map((c) => [c.status, c._count])),
      };
    },

    async recentActivity() {
      const rows = await prisma.auditLog.findMany({
        orderBy: { id: 'desc' },
        take: 10,
        include: { actor: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } },
      });
      return rows.map((r) => ({
        id: r.id.toString(),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actor: r.actor ? (r.actor.profile ? `${r.actor.profile.firstName} ${r.actor.profile.lastName}` : r.actor.email) : 'System',
        createdAt: r.createdAt,
      }));
    },
  };

  return {
    async overview(auth, { currency = 'GHS' } = {}) {
      const perms = await auth.permissions();
      const key = `${currency}|${[...perms].sort().join(',')}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
      const value = await this.compute(perms, currency);
      cache.set(key, { at: Date.now(), value });
      if (cache.size > 50) cache.delete(cache.keys().next().value);
      return value;
    },

    async compute(perms, currency) {
      const can = new Set(perms);
      const queue = async (perm, fn) => (can.has(perm) ? fn() : null);
      const [users, kyc, money, investments, compliance, recentActivity, pending] = await Promise.all([
        queue('users:read:any', sections.users),
        queue('kyc:read:any', sections.kyc),
        can.has('deposits:read:any') || can.has('withdrawals:read:any') || can.has('ledger:read') ? sections.money(currency) : null,
        queue('investments:orders:read:any', () => sections.investments(currency)),
        can.has('fraud:alerts:read') || can.has('compliance:cases:read') ? sections.compliance() : null,
        queue('audit:read', sections.recentActivity),
        Promise.all([
          can.has('approvals:decide') ? approvals.pendingCount() : null,
          can.has('ledger:adjustment:approve') ? prisma.ledgerAdjustment.count({ where: { status: 'PENDING' } }) : null,
          can.has('kyc:review') ? prisma.investorProfile.count({ where: { kycStatus: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }) : null,
          can.has('withdrawals:approve') ? prisma.withdrawal.count({ where: { status: 'REQUESTED' } }) : null,
          can.has('investments:orders:manage') ? prisma.investmentOrder.count({ where: { status: 'PENDING' } }) : null,
          can.has('referrals:manage') ? prisma.referral.count({ where: { status: 'QUALIFIED' } }) : null,
          can.has('support:tickets:manage')
            ? prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'ESCALATED'] }, assigneeId: null } })
            : null,
          can.has('fraud:alerts:manage') ? prisma.monitoringAlert.count({ where: { status: 'OPEN' } }) : null,
        ]),
      ]);
      const keys = [
        'approvalRequests',
        'ledgerAdjustments',
        'kycReviews',
        'withdrawals',
        'orders',
        'referrals',
        'unassignedTickets',
        'monitoringAlerts',
      ];
      return {
        asOf: new Date().toISOString(),
        users,
        kyc,
        money,
        investments,
        compliance,
        recentActivity,
        pending: Object.fromEntries(keys.map((k, i) => [k, pending[i]]).filter(([, v]) => v !== null)),
      };
    },
  };
}
