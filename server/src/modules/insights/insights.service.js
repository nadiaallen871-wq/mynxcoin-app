import { Prisma } from '@prisma/client';
import { NotFoundError } from '../../utils/errors.js';

const DAY_MS = 86_400_000;
const pct = (d) => (d === null || d === undefined ? null : new Prisma.Decimal(String(d)).times(100).toFixed());
const bps = (part, total) => (total ? Number((part * 10_000n) / total) : 0);

/**
 * Risk management and business-intelligence views for staff:
 *  - concentration of customer investments by product, issuer and risk level
 *  - an explainable fraud/AML risk score per user (each point has a stated reason)
 *  - the consolidated fee schedule
 *  - funnel and monthly KPIs
 * Figures are per currency and never combined across currencies.
 */
export function createInsightsService({ prisma, settings }) {
  return {
    async concentration({ currency = 'GHS' } = {}) {
      const threshold = await settings.get('risk.concentration_threshold_bps');
      const holdings = await prisma.investmentHolding.findMany({
        where: { currency, status: { not: 'MATURED' } },
        select: {
          principalMinor: true,
          userId: true,
          product: { select: { id: true, name: true, issuerName: true, riskLevel: true, capacityMinor: true } },
        },
      });
      const total = holdings.reduce((a, h) => a + h.principalMinor, 0n);
      const group = (keyOf, labelOf, extra = () => ({})) => {
        const m = new Map();
        for (const h of holdings) {
          const k = keyOf(h);
          const g = m.get(k) ?? { key: String(k), label: labelOf(h), principal: 0n, investors: new Set(), ...extra(h) };
          g.principal += h.principalMinor;
          g.investors.add(h.userId);
          m.set(k, g);
        }
        return [...m.values()]
          .sort((a, b) => (b.principal > a.principal ? 1 : -1))
          .map(({ investors, principal, capacity, ...g }) => ({
            ...g,
            principalMinor: principal.toString(),
            investors: investors.size,
            shareBps: bps(principal, total),
            flagged: bps(principal, total) > threshold,
            ...(capacity !== undefined ? { capacityUsedBps: capacity ? bps(principal, capacity) : null } : {}),
          }));
      };
      return {
        currency,
        totalMinor: total.toString(),
        thresholdBps: threshold,
        byProduct: group(
          (h) => h.product.id,
          (h) => h.product.name,
          (h) => ({ capacity: h.product.capacityMinor }),
        ),
        byIssuer: group(
          (h) => h.product.issuerName,
          (h) => h.product.issuerName,
        ),
        byRiskLevel: group(
          (h) => h.product.riskLevel,
          (h) => `Risk ${h.product.riskLevel}`,
        ),
      };
    },

    /**
     * Rule-based score from 0 (no signals) to 100. It ranks people for review; it is not
     * a decision and never blocks anything by itself.
     */
    async riskScore(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          createdAt: true,
          type: true,
          investorProfile: { select: { riskRating: true, isPoliticallyExposed: true, kycStatus: true } },
        },
      });
      if (!user) throw new NotFoundError('User not found');
      const since30 = new Date(Date.now() - 30 * DAY_MS);
      const since7 = new Date(Date.now() - 7 * DAY_MS);
      const [alerts, flaggedWithdrawals, failedLogins, flaggedReferrals, openCases] = await Promise.all([
        prisma.monitoringAlert.groupBy({ by: ['severity'], where: { userId, status: { not: 'DISMISSED' } }, _count: true }),
        prisma.withdrawal.count({ where: { userId, createdAt: { gte: since30 }, NOT: { riskFlags: { isEmpty: true } } } }),
        prisma.loginAttempt.count({ where: { userId, success: false, createdAt: { gte: since7 } } }),
        prisma.referral.count({ where: { referrerId: userId, NOT: { flags: { isEmpty: true } } } }),
        prisma.complianceCase.count({ where: { subjectUserId: userId, status: { notIn: ['CLOSED_NO_ACTION', 'CLOSED_ACTION_TAKEN'] } } }),
      ]);
      const factors = [];
      const add = (points, reason) => points > 0 && factors.push({ points, reason });
      const p = user.investorProfile;
      add({ HIGH: 25, MEDIUM: 10 }[p?.riskRating] ?? 0, `Customer risk rating ${p?.riskRating?.toLowerCase()}`);
      add(p?.isPoliticallyExposed ? 20 : 0, 'Politically exposed person');
      const by = Object.fromEntries(alerts.map((a) => [a.severity, a._count]));
      add(
        Math.min(30, (by.HIGH ?? 0) * 15 + (by.MEDIUM ?? 0) * 6 + (by.LOW ?? 0) * 2),
        `${(by.HIGH ?? 0) + (by.MEDIUM ?? 0) + (by.LOW ?? 0)} monitoring alert(s) not dismissed`,
      );
      add(Math.min(15, flaggedWithdrawals * 5), `${flaggedWithdrawals} flagged withdrawal(s) in 30 days`);
      add(failedLogins >= 5 ? 10 : failedLogins >= 3 ? 5 : 0, `${failedLogins} failed sign-ins in 7 days`);
      add(Math.min(10, flaggedReferrals * 5), `${flaggedReferrals} referral(s) with abuse signals`);
      add(openCases ? 15 : 0, `${openCases} open compliance case(s)`);
      add(Date.now() - user.createdAt.getTime() < 30 * DAY_MS ? 5 : 0, 'Account younger than 30 days');
      const score = Math.min(
        100,
        factors.reduce((a, f) => a + f.points, 0),
      );
      return { userId, score, band: score >= 50 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW', factors, computedAt: new Date().toISOString() };
    },

    /** Highest-scoring people, drawn from recent alerts, open cases and high-risk or PEP profiles. */
    async topRisk({ limit = 20 } = {}) {
      const [alerted, cased, profiled] = await Promise.all([
        prisma.monitoringAlert.findMany({
          where: { status: { not: 'DISMISSED' } },
          orderBy: { createdAt: 'desc' },
          select: { userId: true },
          take: 300,
        }),
        prisma.complianceCase.findMany({
          where: { status: { notIn: ['CLOSED_NO_ACTION', 'CLOSED_ACTION_TAKEN'] } },
          orderBy: { updatedAt: 'desc' },
          select: { subjectUserId: true },
          take: 100,
        }),
        prisma.investorProfile.findMany({
          where: { OR: [{ riskRating: 'HIGH' }, { isPoliticallyExposed: true }] },
          orderBy: { updatedAt: 'desc' },
          select: { userId: true },
          take: 100,
        }),
      ]);
      const ids = [
        ...new Set([...alerted.map((a) => a.userId), ...cased.map((c) => c.subjectUserId), ...profiled.map((p) => p.userId)]),
      ].slice(0, 200);
      const users = await prisma.user.findMany({
        where: { id: { in: ids }, type: { not: 'STAFF' } },
        select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } },
      });
      const scored = await Promise.all(
        users.map(async (u) => ({
          ...(await this.riskScore(u.id)),
          email: u.email,
          name: u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u.email,
        })),
      );
      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    },

    async feeSchedule() {
      const [products, withdrawalFee, spread] = await Promise.all([
        prisma.investmentProduct.findMany({
          where: { status: { in: ['PUBLISHED', 'CLOSED', 'SUSPENDED'] } },
          select: { name: true, slug: true, currency: true, entryFeeRate: true, managementFeeRate: true, status: true, version: true },
          orderBy: { name: 'asc' },
        }),
        settings.get('payments.withdrawal_fee_minor'),
        settings.get('fx.spread_bps'),
      ]);
      return {
        platform: [
          { fee: 'Deposit', basis: 'Payment provider charges are paid by Mynx', amount: null },
          { fee: 'Withdrawal', basis: 'Flat amount per withdrawal', amount: { amountMinor: String(withdrawalFee), currency: 'GHS' } },
          { fee: 'Currency conversion', basis: `${spread / 100}% of the amount converted`, amount: null },
        ],
        products: products.map((p) => ({
          name: p.name,
          slug: p.slug,
          currency: p.currency,
          status: p.status,
          termsVersion: p.version,
          entryFeePercent: pct(p.entryFeeRate) ?? '0',
          managementFeePercent: pct(p.managementFeeRate) ?? '0',
        })),
        note: 'Product fees are fixed per product version: investors keep the fees of the version they invested under.',
      };
    },

    /** Funnel and monthly KPIs for the last `months` months (UTC). */
    async kpis({ months = 12, currency = 'GHS' } = {}) {
      const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - (months - 1), 1));
      const q = (sql) => prisma.$queryRaw(sql);
      const [registered, verified, funded, invested, monthly] = await Promise.all([
        prisma.user.count({ where: { type: { not: 'STAFF' } } }),
        prisma.investorProfile.count({ where: { kycStatus: 'APPROVED' } }),
        prisma.deposit.groupBy({ by: ['userId'], where: { status: 'SUCCEEDED' } }).then((r) => r.length),
        prisma.investmentOrder.groupBy({ by: ['userId'], where: { confirmEntryId: { not: null } } }).then((r) => r.length),
        q(Prisma.sql`
          WITH months AS (SELECT generate_series(${start}::timestamptz, date_trunc('month', now()), interval '1 month') AS m)
          SELECT to_char(m, 'YYYY-MM') AS month,
            (SELECT COUNT(*) FROM users u WHERE u.type <> 'STAFF' AND u.created_at >= m AND u.created_at < m + interval '1 month')::int AS new_investors,
            (SELECT COUNT(*) FROM investor_profiles p WHERE p.kyc_verified_at >= m AND p.kyc_verified_at < m + interval '1 month')::int AS verified,
            (SELECT COALESCE(SUM(amount_minor), 0) FROM deposits d WHERE d.status = 'SUCCEEDED' AND d.currency = ${currency} AND d.completed_at >= m AND d.completed_at < m + interval '1 month')::bigint AS deposits,
            (SELECT COALESCE(SUM(amount_minor), 0) FROM withdrawals w WHERE w.status = 'COMPLETED' AND w.currency = ${currency} AND w.completed_at >= m AND w.completed_at < m + interval '1 month')::bigint AS withdrawals,
            (SELECT COALESCE(SUM(amount_minor), 0) FROM investment_orders o WHERE o.confirm_entry_id IS NOT NULL AND o.currency = ${currency} AND o.confirmed_at >= m AND o.confirmed_at < m + interval '1 month')::bigint AS invested,
            (SELECT COALESCE(SUM(principal_minor), 0) FROM investment_holdings h WHERE h.currency = ${currency} AND h.created_at < m + interval '1 month' AND (h.matured_at IS NULL OR h.matured_at >= m + interval '1 month'))::bigint AS aum
          FROM months ORDER BY m`),
      ]);
      return {
        currency,
        funnel: [
          { stage: 'Registered', count: registered },
          { stage: 'Identity verified', count: verified },
          { stage: 'Made a deposit', count: funded },
          { stage: 'Invested', count: invested },
        ],
        monthly: monthly.map((r) => ({
          month: r.month,
          newInvestors: r.new_investors,
          verified: r.verified,
          depositsMinor: BigInt(r.deposits).toString(),
          withdrawalsMinor: BigInt(r.withdrawals).toString(),
          netFlowMinor: (BigInt(r.deposits) - BigInt(r.withdrawals)).toString(),
          investedMinor: BigInt(r.invested).toString(),
          aumEndOfMonthMinor: BigInt(r.aum).toString(),
        })),
      };
    },
  };
}
