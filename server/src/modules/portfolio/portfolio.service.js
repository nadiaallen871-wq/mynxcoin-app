import { Prisma } from '@prisma/client';
import { RoundingMode, accrue, money } from '../../utils/money.js';

const DAY_MS = 86_400_000;
const utcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d) => d.toISOString().slice(0, 10);
const amount = (minor, currency) => ({ amountMinor: minor.toString(), currency });
// Snapshot decimals may serialise in exponent form, so normalise to a plain decimal string for exact parsing.
// eslint-disable-next-line no-restricted-properties
const plainRate = (v) => (v === null || v === undefined ? null : new Prisma.Decimal(String(v)).toFixed());
// eslint-disable-next-line no-restricted-properties
const ratePercent = (v) => (v === null || v === undefined ? null : new Prisma.Decimal(String(v)).times(100).toFixed());

/**
 * How holdings are valued. There is no market price feed, so nothing is marked to market:
 *  - ACCRUED: fixed-rate products are shown at principal plus interest accrued at the
 *    contractual rate, less the management fee accrued so far (both simple, actual/365).
 *    This is an estimate until the custodian reports the actual proceeds at maturity.
 *  - COST: target-return and variable products are carried at principal (cost).
 *  - SETTLED: matured holdings, valued at the proceeds actually received (realized).
 */
export const VALUATION_METHODS = {
  ACCRUED: 'Estimated: principal plus interest accrued at the contractual rate, less management fee accrued. Not guaranteed until settled.',
  COST: 'At cost: no reliable price is available for this product, so it is shown at the amount invested.',
  SETTLED: 'Realized: proceeds actually received at maturity, after fees.',
};

/** Value of one holding on a given day, from its own terms snapshot. Returns null if not yet held on that day. */
export function valueHolding(h, terms, asOf) {
  const day = utcDay(asOf);
  if (h.startDate > day) return null;
  const principal = h.principalMinor;
  if (h.status === 'MATURED' && h.maturedAt && utcDay(h.maturedAt) <= day) {
    const net = h.proceedsMinor - (h.managementFeeMinor ?? 0n);
    return { method: 'SETTLED', principal, value: 0n, realized: net - principal, unrealized: 0n, proceeds: net };
  }
  const rate = plainRate(terms?.annualRate);
  if (terms?.returnType === 'FIXED' && rate) {
    const end = h.maturityDate && h.maturityDate < day ? h.maturityDate : day;
    const days = Math.max(0, Math.floor((end.getTime() - h.startDate.getTime()) / DAY_MS));
    const p = money(principal, h.currency);
    const interest = accrue(p, rate, days, RoundingMode.DOWN).minor;
    const fee = accrue(p, plainRate(terms.managementFeeRate) ?? '0', days, RoundingMode.UP).minor;
    const value = principal + interest - fee;
    return { method: 'ACCRUED', principal, value, realized: 0n, unrealized: value - principal, accruedInterest: interest, accruedFee: fee };
  }
  return { method: 'COST', principal, value: principal, realized: 0n, unrealized: 0n };
}

export function createPortfolioService({ prisma, settings = null }) {
  async function holdingsWithTerms(userId, currency) {
    const holdings = await prisma.investmentHolding.findMany({
      where: { userId, currency },
      include: {
        product: { select: { slug: true, name: true, productType: true, riskLevel: true } },
        order: { select: { orderNumber: true, productVersion: true, feeMinor: true, amountMinor: true } },
      },
      orderBy: { startDate: 'asc' },
    });
    const keys = holdings.map((h) => ({ productId: h.productId, version: h.order.productVersion }));
    const versions = keys.length
      ? await prisma.productVersion.findMany({ where: { OR: keys }, select: { productId: true, version: true, snapshot: true } })
      : [];
    const termsOf = new Map(versions.map((v) => [`${v.productId}:${v.version}`, v.snapshot]));
    return holdings.map((h) => ({ ...h, terms: termsOf.get(`${h.productId}:${h.order.productVersion}`) ?? {} }));
  }

  /** Daily net movement on the user's wallet accounts, customer view (credit = +). */
  async function walletDailyMovements(userId, currency) {
    const rows = await prisma.$queryRaw`
      SELECT date_trunc('day', e.posted_at AT TIME ZONE 'UTC')::date AS day, a.purpose::text AS purpose, SUM(-l.amount_minor)::bigint AS net
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
      WHERE a.owner_user_id = ${userId}::uuid AND a.currency = ${currency}
      GROUP BY 1, 2 ORDER BY 1`;
    return rows.map((r) => ({ day: isoDay(new Date(r.day)), purpose: r.purpose, net: BigInt(r.net) }));
  }

  async function walletBalances(userId, currency) {
    const accounts = await prisma.ledgerAccount.findMany({
      where: { ownerUserId: userId, currency, purpose: { in: ['CUSTOMER_AVAILABLE', 'CUSTOMER_RESERVED'] } },
      include: { balance: true },
    });
    const of = (purpose) => -(accounts.find((a) => a.purpose === purpose)?.balance?.balanceMinor ?? 0n);
    return { available: of('CUSTOMER_AVAILABLE'), reserved: of('CUSTOMER_RESERVED') };
  }

  function summarise(holdings, asOf) {
    let invested = 0n;
    let estimated = 0n;
    let unrealized = 0n;
    let realized = 0n;
    const valued = [];
    for (const h of holdings) {
      const v = valueHolding(h, h.terms, asOf);
      if (!v) continue;
      valued.push({ h, v });
      realized += v.realized;
      if (v.method !== 'SETTLED') {
        invested += v.principal;
        estimated += v.value;
        unrealized += v.unrealized;
      }
    }
    return { invested, estimated, unrealized, realized, valued };
  }

  function allocation(valued, keyOf, labelOf) {
    const groups = new Map();
    for (const { h, v } of valued) {
      if (v.method === 'SETTLED') continue;
      const key = keyOf(h);
      groups.set(key, { key, label: labelOf(h), value: (groups.get(key)?.value ?? 0n) + v.value });
    }
    const total = [...groups.values()].reduce((a, g) => a + g.value, 0n);
    return [...groups.values()]
      .sort((a, b) => (b.value > a.value ? 1 : -1))
      .map((g) => ({
        key: String(g.key),
        label: g.label,
        valueMinor: g.value.toString(),
        shareBasisPoints: total ? Number((g.value * 10_000n) / total) : 0,
      }));
  }

  /**
   * Value history: one point per day (weekly beyond 120 days), rebuilt from the ledger and
   * holding records as of each date with today's valuation rules.
   */
  async function history(userId, { currency = 'GHS', from, to = new Date() } = {}, preloaded = null) {
    const holdings = preloaded ?? (await holdingsWithTerms(userId, currency));
    const moves = await walletDailyMovements(userId, currency);
    const first = [moves[0]?.day, holdings[0] && isoDay(holdings[0].startDate)].filter(Boolean).sort()[0];
    if (!first) return [];
    const end = utcDay(to);
    let start = utcDay(new Date(`${first}T00:00:00Z`));
    if (from && utcDay(from) > start) start = utcDay(from);
    if (start > end) return [];
    const spanDays = Math.round((end - start) / DAY_MS);
    const step = spanDays > 120 ? 7 : 1;

    let mi = 0;
    let wallet = 0n;
    const points = [];
    for (let t = start.getTime(); ; t += step * DAY_MS) {
      const day = new Date(Math.min(t, end.getTime()));
      const key = isoDay(day);
      while (mi < moves.length && moves[mi].day <= key) wallet += moves[mi++].net;
      const { estimated, invested } = summarise(holdings, day);
      points.push({
        date: key,
        walletMinor: wallet.toString(),
        investedMinor: invested.toString(),
        holdingsMinor: estimated.toString(),
        totalMinor: (wallet + estimated).toString(),
      });
      if (day.getTime() >= end.getTime()) break;
    }
    return points;
  }

  /** Portfolio risk metrics over open holdings, weighted by current value. */
  async function riskMetrics(valued) {
    const open = valued.filter(({ v }) => v.method !== 'SETTLED');
    const total = open.reduce((a, { v }) => a + v.value, 0n);
    const highLevel = settings ? await settings.get('risk.high_risk_level') : 5;
    if (!total) return { holdings: 0, weightedRiskLevel: null, highRiskShareBps: 0, largestHoldingShareBps: 0, highRiskLevel: highLevel };
    const weighted = open.reduce((a, { h, v }) => a + v.value * BigInt(h.product.riskLevel), 0n);
    const high = open.filter(({ h }) => h.product.riskLevel >= highLevel).reduce((a, { v }) => a + v.value, 0n);
    const largest = open.reduce((m, { v }) => (v.value > m ? v.value : m), 0n);
    const tenths = (weighted * 10n) / total;
    return {
      holdings: open.length,
      weightedRiskLevel: `${tenths / 10n}.${tenths % 10n}`,
      highRiskShareBps: Number((high * 10_000n) / total),
      largestHoldingShareBps: Number((largest * 10_000n) / total),
      highRiskLevel: highLevel,
    };
  }

  return {
    valueHolding,
    history,

    async dashboard(userId, { currency = 'GHS', now = new Date() } = {}) {
      const holdings = await holdingsWithTerms(userId, currency);
      const [balances, pendingOrders, profile, unread, latest, recent, fees] = await Promise.all([
        walletBalances(userId, currency),
        prisma.investmentOrder.aggregate({
          where: { userId, currency, status: { in: ['PENDING', 'PROCESSING'] } },
          _count: true,
          _sum: { amountMinor: true },
        }),
        prisma.investorProfile.findUnique({ where: { userId }, select: { kycStatus: true } }),
        prisma.notification.count({ where: { userId, readAt: null } }),
        prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 3 }),
        prisma.journalLine.findMany({
          where: { account: { ownerUserId: userId, currency, purpose: 'CUSTOMER_AVAILABLE' } },
          include: { entry: { select: { type: true, description: true, postedAt: true } } },
          orderBy: { id: 'desc' },
          take: 6,
        }),
        this.feeTotals(userId, { currency }),
      ]);
      const s = summarise(holdings, now);
      const active = s.valued.filter(({ v }) => v.method !== 'SETTLED');
      const upcoming = active
        .filter(({ h }) => h.maturityDate)
        .sort((a, b) => a.h.maturityDate - b.h.maturityDate)
        .slice(0, 5)
        .map(({ h, v }) => ({
          holdingId: h.id,
          product: h.product,
          maturityDate: isoDay(h.maturityDate),
          daysToMaturity: Math.max(0, Math.ceil((h.maturityDate - utcDay(now)) / DAY_MS)),
          principal: amount(v.principal, currency),
          status: h.status,
        }));
      return {
        asOf: now.toISOString(),
        currency,
        verification: profile?.kycStatus ?? 'NOT_STARTED',
        wallet: { available: amount(balances.available, currency), reserved: amount(balances.reserved, currency) },
        portfolio: {
          totalValue: amount(balances.available + balances.reserved + s.estimated, currency),
          investedCapital: amount(s.invested, currency),
          holdingsValue: amount(s.estimated, currency),
          unrealizedReturn: amount(s.unrealized, currency),
          realizedReturn: amount(s.realized, currency),
          totalReturn: amount(s.unrealized + s.realized, currency),
          feesPaid: amount(fees.total, currency),
        },
        counts: {
          activeHoldings: active.length,
          pendingOrders: pendingOrders._count,
          pendingAmount: amount(pendingOrders._sum.amountMinor ?? 0n, currency),
          completedHoldings: s.valued.length - active.length,
        },
        allocation: {
          byType: allocation(
            s.valued,
            (h) => h.product.productType,
            (h) => h.product.productType,
          ),
          byRisk: allocation(
            s.valued,
            (h) => h.product.riskLevel,
            (h) => `Risk ${h.product.riskLevel}`,
          ),
        },
        upcomingMaturities: upcoming,
        recentTransactions: recent.map((l) => ({
          id: l.id.toString(),
          type: l.entry.type,
          description: l.entry.description,
          postedAt: l.entry.postedAt,
          amount: amount(-l.amountMinor, currency),
        })),
        notifications: {
          unread,
          latest: latest.map((n) => ({ id: n.id, title: n.title, link: n.link, read: Boolean(n.readAt), createdAt: n.createdAt })),
        },
        methods: VALUATION_METHODS,
      };
    },

    /** Holdings with their valuation, method and realized/unrealized split. */
    async holdings(userId, { currency = 'GHS', now = new Date() } = {}) {
      const holdings = await holdingsWithTerms(userId, currency);
      return holdings.map((h) => {
        const v = valueHolding(h, h.terms, now) ?? {
          method: 'COST',
          principal: h.principalMinor,
          value: h.principalMinor,
          realized: 0n,
          unrealized: 0n,
        };
        return {
          id: h.id,
          orderNumber: h.order.orderNumber.toString(),
          product: h.product,
          status: h.status,
          startDate: isoDay(h.startDate),
          maturityDate: h.maturityDate ? isoDay(h.maturityDate) : null,
          annualRatePercent: ratePercent(h.terms.annualRate),
          returnType: h.terms.returnType ?? null,
          principal: amount(v.principal, currency),
          entryFee: amount(h.order.feeMinor, currency),
          value: amount(v.value, currency),
          unrealized: amount(v.unrealized, currency),
          realized: amount(v.realized, currency),
          proceeds: v.proceeds !== undefined ? amount(v.proceeds, currency) : null,
          managementFee: h.managementFeeMinor !== null ? amount(h.managementFeeMinor, currency) : null,
          valuationMethod: v.method,
          valuedAt: now.toISOString(),
          rollover: h.rollover,
          rolloverNote: h.rolloverNote,
          rolloverOrderId: h.rolloverOrderId,
        };
      });
    },

    /** Fees the investor has paid, by kind. Deposit provider charges are absorbed by Mynx and are not listed. */
    async feeTotals(userId, { currency = 'GHS', from = null, to = null } = {}) {
      const range = (field) => (from || to ? { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {});
      const [entry, mgmt, withdrawal] = await Promise.all([
        prisma.investmentOrder.aggregate({
          where: { userId, currency, confirmEntryId: { not: null }, ...range('confirmedAt') },
          _sum: { feeMinor: true },
        }),
        prisma.investmentHolding.aggregate({
          where: { userId, currency, status: 'MATURED', ...range('maturedAt') },
          _sum: { managementFeeMinor: true },
        }),
        prisma.withdrawal.aggregate({
          where: { userId, currency, status: 'COMPLETED', ...range('completedAt') },
          _sum: { feeMinor: true },
        }),
      ]);
      const e = entry._sum.feeMinor ?? 0n;
      const m = mgmt._sum.managementFeeMinor ?? 0n;
      const w = withdrawal._sum.feeMinor ?? 0n;
      return { entry: e, management: m, withdrawal: w, total: e + m + w };
    },

    /** Cash flows by month and type, fees, realized results and risk exposure over a period. */
    async analytics(userId, { currency = 'GHS', from, to }) {
      const holdings = await holdingsWithTerms(userId, currency);
      const flows = await prisma.$queryRaw`
        SELECT to_char(date_trunc('month', e.posted_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month, e.type AS type, SUM(-l.amount_minor)::bigint AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id
        JOIN ledger_accounts a ON a.id = l.account_id
        WHERE a.owner_user_id = ${userId}::uuid AND a.currency = ${currency} AND a.purpose = 'CUSTOMER_AVAILABLE'
          AND e.posted_at >= ${from} AND e.posted_at < ${to}
        GROUP BY 1, 2 ORDER BY 1, 2`;
      const fees = await this.feeTotals(userId, { currency, from, to });
      const realized = holdings
        .filter((h) => h.status === 'MATURED' && h.maturedAt >= from && h.maturedAt < to)
        .map((h) => {
          const v = valueHolding(h, h.terms, h.maturedAt);
          return {
            holdingId: h.id,
            product: h.product.name,
            maturedAt: h.maturedAt,
            principal: amount(h.principalMinor, currency),
            proceeds: amount(v.proceeds, currency),
            result: amount(v.realized, currency),
          };
        });
      const now = new Date(Math.min(Date.now(), to.getTime()));
      const s = summarise(holdings, now);
      return {
        period: { from: from.toISOString(), to: to.toISOString() },
        currency,
        cashFlows: flows.map((f) => ({ month: f.month, type: f.type, netMinor: BigInt(f.net).toString() })),
        fees: {
          entry: amount(fees.entry, currency),
          management: amount(fees.management, currency),
          withdrawal: amount(fees.withdrawal, currency),
          total: amount(fees.total, currency),
        },
        realized,
        realizedTotal: amount(
          realized.reduce((a, r) => a + BigInt(r.result.amountMinor), 0n),
          currency,
        ),
        unrealizedNow: amount(s.unrealized, currency),
        riskExposure: allocation(
          s.valued,
          (h) => h.product.riskLevel,
          (h) => `Risk ${h.product.riskLevel}`,
        ),
        riskMetrics: await riskMetrics(s.valued),
        history: await history(userId, { currency, from, to: now }, holdings),
        methods: VALUATION_METHODS,
      };
    },

    walletBalances,
    holdingsWithTerms,
  };
}
