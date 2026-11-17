import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';

const INTEREST_TYPES = new Set([
  'TREASURY_BILL',
  'GOVERNMENT_BOND',
  'CORPORATE_BOND',
  'FIXED_DEPOSIT',
  'MONEY_MARKET_FUND',
  'FIXED_INCOME_FUND',
]);
const plain = (d) => new Prisma.Decimal(String(d)).toFixed();
const fraction = (rate) => {
  const [w, f = ''] = plain(rate).split('.');
  return { n: BigInt(w + f), d: 10n ** BigInt(f.length) };
};
const isoDay = (d) => d.toISOString().slice(0, 10);

/** Income from fixed-income products is treated as interest; other product types as capital gains. */
export const incomeTypeOf = (productType) => (INTEREST_TYPES.has(productType) ? 'INTEREST' : 'CAPITAL_GAIN');

/**
 * Configurable tax rules and annual tax summaries.
 *
 * No tax rule is built in: every rule (jurisdiction, income type, rate, effective dates,
 * legal reference) is entered from a qualified adviser's guidance and applies only after
 * a second person approves it. Statements show income figures and, where a rule exists,
 * an estimate. Nothing is withheld automatically: withholding would need a legal basis,
 * remittance arrangements with the tax authority and its own ledger accounts.
 */
export function createTaxService({ prisma, approvals }) {
  const serialize = (r) => ({
    id: r.id,
    jurisdiction: r.jurisdiction,
    incomeType: r.incomeType,
    investorType: r.investorType,
    ratePercent: (() => {
      const { n, d } = fraction(r.rate);
      const pct = (n * 100n * 10_000n) / d; // 4 decimal places
      const s = pct.toString().padStart(5, '0');
      return `${s.slice(0, -4)}.${s.slice(-4)}`.replace(/\.?0+$/, '');
    })(),
    effectiveFrom: isoDay(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? isoDay(r.effectiveTo) : null,
    description: r.description,
    legalReference: r.legalReference,
    active: r.active,
    createdAt: r.createdAt,
  });

  approvals.register('TAX_RULE', {
    async apply(tx, payload, { decider, request }) {
      if (payload.deactivateId) {
        const { count } = await tx.taxRule.updateMany({ where: { id: payload.deactivateId, active: true }, data: { active: false } });
        if (count !== 1) throw new ConflictError('That rule is no longer active', 'NOT_ACTIVE');
        return payload;
      }
      const rule = await tx.taxRule.create({
        data: {
          jurisdiction: payload.jurisdiction,
          incomeType: payload.incomeType,
          investorType: payload.investorType ?? null,
          rate: payload.rate,
          effectiveFrom: new Date(`${payload.effectiveFrom}T00:00:00Z`),
          effectiveTo: payload.effectiveTo ? new Date(`${payload.effectiveTo}T00:00:00Z`) : null,
          description: payload.description,
          legalReference: payload.legalReference,
          createdById: request.requestedById,
          approvedById: decider.id,
        },
      });
      return { ruleId: rule.id };
    },
  });

  /** The rule in force for an income item, most specific investor type first. */
  function ruleFor(rules, { jurisdiction, incomeType, investorType, on }) {
    return rules
      .filter(
        (r) =>
          r.active &&
          r.jurisdiction === jurisdiction &&
          r.incomeType === incomeType &&
          (!r.investorType || r.investorType === investorType),
      )
      .filter((r) => r.effectiveFrom <= on && (!r.effectiveTo || r.effectiveTo > on))
      .sort((a, b) => (b.investorType ? 1 : 0) - (a.investorType ? 1 : 0))[0];
  }

  return {
    async list() {
      return (await prisma.taxRule.findMany({ orderBy: [{ jurisdiction: 'asc' }, { incomeType: 'asc' }, { effectiveFrom: 'desc' }] })).map(
        serialize,
      );
    },

    async propose(auth, input, ctx) {
      if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
        throw new ValidationError([{ location: 'body', path: 'effectiveTo', message: 'The end date must be after the start date' }]);
      }
      const r = await prisma.$transaction((tx) =>
        approvals.create(
          tx,
          {
            type: 'TAX_RULE',
            payload: input,
            summary: `Tax rule: ${input.incomeType.toLowerCase().replace('_', ' ')} in ${input.jurisdiction} at ${plain(input.rate)} from ${input.effectiveFrom}`,
            reason: input.reason,
            requestedById: auth.user.id,
          },
          ctx,
        ),
      );
      return approvals.get(r.id);
    },

    async proposeDeactivation(auth, id, { reason }, ctx) {
      const rule = await prisma.taxRule.findUnique({ where: { id } });
      if (!rule) throw new NotFoundError('Tax rule not found');
      if (!rule.active) throw new ConflictError('That rule is already inactive', 'NOT_ACTIVE');
      const r = await prisma.$transaction((tx) =>
        approvals.create(
          tx,
          {
            type: 'TAX_RULE',
            payload: { deactivateId: id },
            summary: `Deactivate tax rule ${rule.jurisdiction} ${rule.incomeType}`,
            reason,
            requestedById: auth.user.id,
          },
          ctx,
        ),
      );
      return approvals.get(r.id);
    },

    /**
     * Income realised in a calendar year (UTC), per item, with the matching rule's estimate.
     * Amounts are per currency and never added across currencies.
     */
    async yearSummary(userId, year) {
      const from = new Date(Date.UTC(year, 0, 1));
      const to = new Date(Date.UTC(year + 1, 0, 1));
      const [user, holdings, rewards, rules] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { type: true, profile: { select: { country: true } } } }),
        prisma.investmentHolding.findMany({
          where: { userId, status: 'MATURED', maturedAt: { gte: from, lt: to } },
          include: { product: { select: { name: true, productType: true } } },
          orderBy: { maturedAt: 'asc' },
        }),
        prisma.referralReward.findMany({ where: { referrerId: userId, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'asc' } }),
        prisma.taxRule.findMany(),
      ]);
      const jurisdiction = user?.profile?.country ?? 'GH';
      const item = (incomeType, label, date, currency, incomeMinor) => {
        const rule = incomeMinor > 0n ? ruleFor(rules, { jurisdiction, incomeType, investorType: user.type, on: date }) : null;
        let estimatedTaxMinor = null;
        if (rule) {
          const { n, d } = fraction(rule.rate);
          estimatedTaxMinor = (incomeMinor * n * 2n + d) / (2n * d); // half up
        }
        return {
          incomeType,
          label,
          date: isoDay(date),
          currency,
          incomeMinor: incomeMinor.toString(),
          rule: rule ? serialize(rule) : null,
          estimatedTaxMinor: estimatedTaxMinor === null ? null : estimatedTaxMinor.toString(),
        };
      };
      const items = [
        ...holdings.map((h) =>
          item(
            incomeTypeOf(h.product.productType),
            h.product.name,
            h.maturedAt,
            h.currency,
            h.proceedsMinor - (h.managementFeeMinor ?? 0n) - h.principalMinor,
          ),
        ),
        ...rewards.map((r) => item('REFERRAL_REWARD', 'Referral reward', r.createdAt, r.currency, r.amountMinor)),
      ];
      const totals = {};
      for (const i of items) {
        const t = (totals[i.currency] ??= { incomeMinor: 0n, estimatedTaxMinor: 0n });
        t.incomeMinor += BigInt(i.incomeMinor);
        if (i.estimatedTaxMinor) t.estimatedTaxMinor += BigInt(i.estimatedTaxMinor);
      }
      return {
        year,
        jurisdiction,
        items,
        totals: Object.fromEntries(
          Object.entries(totals).map(([c, t]) => [
            c,
            { incomeMinor: t.incomeMinor.toString(), estimatedTaxMinor: t.estimatedTaxMinor.toString() },
          ]),
        ),
        rulesConfigured: rules.some((r) => r.active && r.jurisdiction === jurisdiction),
      };
    },
  };
}
