import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { money, toDecimalString } from '../../utils/money.js';
import { runLedgerTx } from '../ledger/ledger.service.js';
import { assertVerified, assertWalletActive, parseAmount } from '../payments/payment-helpers.js';

export const ANCHOR = 'GHS';
const QUOTE_TTL_MS = 60_000;
const plain = (d) => new Prisma.Decimal(String(d)).toFixed();
const fraction = (rate) => {
  const [w, f = ''] = plain(rate).split('.');
  return { n: BigInt(w + f), d: 10n ** BigInt(f.length) };
};

/**
 * Currency exchange between an investor's own wallets.
 *
 * - Rates come from the configured provider and are stored as append-only snapshots,
 *   each with the provider's timestamp. A quote uses rates no older than
 *   `fx.max_rate_age_minutes`, refreshing them first if needed.
 * - The conversion is one ledger entry that balances in EACH currency separately:
 *     from: Dr customer available (amount) / Cr FX clearing (amount − fee) / Cr fee income (fee)
 *     to:   Dr FX clearing (converted) / Cr customer available (converted)
 *   Balances in different currencies are never added together.
 * - The converted amount is an exact fraction of the two rates, rounded down once; the
 *   fee (`fx.spread_bps`) is rounded up. Quotes are valid for 60 seconds and usable once.
 */
export function createFxService({ prisma, ledger, wallets, provider, settings, audit, approvals }) {
  const serializeRate = (r) => ({ currency: r.currency, anchor: r.anchor, rate: plain(r.rate), source: r.source, asOf: r.asOf });

  async function refreshRates() {
    const rows = await provider.rates({ anchor: ANCHOR });
    const active = new Set((await prisma.currency.findMany({ select: { code: true } })).map((c) => c.code));
    const stored = [];
    for (const r of rows.filter((x) => active.has(x.currency) && x.currency !== ANCHOR)) {
      stored.push(
        await prisma.exchangeRate.create({
          data: { currency: r.currency, anchor: ANCHOR, rate: plain(r.rate), source: provider.name, asOf: r.asOf },
        }),
      );
    }
    return stored.map(serializeRate);
  }

  async function latest(currency) {
    if (currency === ANCHOR) return { id: null, rate: '1', asOf: new Date(), source: 'anchor' };
    const maxAgeMs = (await settings.get('fx.max_rate_age_minutes')) * 60_000;
    let row = await prisma.exchangeRate.findFirst({ where: { currency }, orderBy: { asOf: 'desc' } });
    if (!row || Date.now() - row.asOf.getTime() > maxAgeMs) {
      await refreshRates();
      row = await prisma.exchangeRate.findFirst({ where: { currency }, orderBy: { asOf: 'desc' } });
    }
    if (!row || Date.now() - row.asOf.getTime() > maxAgeMs) {
      throw new AppError('No current exchange rate is available. Try again later.', { status: 503, code: 'RATE_UNAVAILABLE' });
    }
    return { id: row.id, rate: plain(row.rate), asOf: row.asOf, source: row.source };
  }

  /** Converted minor units of `to` for `minor` of `from`: minor × rateFrom / rateTo, rounded down. */
  function convertMinor(minor, rateFrom, rateTo) {
    const a = fraction(rateFrom);
    const b = fraction(rateTo);
    return (minor * a.n * b.d) / (a.d * b.n);
  }

  async function assertCurrencies(from, to) {
    if (from === to) throw new ValidationError([{ location: 'body', path: 'to', message: 'Choose a different currency' }]);
    const rows = await prisma.currency.findMany({ where: { code: { in: [from, to] } } });
    if (rows.length !== 2 || rows.some((c) => !c.isActive))
      throw new ConflictError('One of these currencies is not available', 'CURRENCY_INACTIVE');
  }

  return {
    refreshRates,

    async rates() {
      const currencies = await prisma.currency.findMany({ orderBy: { code: 'asc' } });
      const latestRows = await Promise.all(
        currencies
          .filter((c) => c.code !== ANCHOR)
          .map((c) => prisma.exchangeRate.findFirst({ where: { currency: c.code }, orderBy: { asOf: 'desc' } })),
      );
      return {
        anchor: ANCHOR,
        provider: provider.name,
        sandbox: provider.name === 'sandbox',
        currencies: currencies.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, active: c.isActive })),
        rates: latestRows.filter(Boolean).map(serializeRate),
      };
    },

    async quote(auth, { from, to, amount }) {
      if (!(await settings.get('fx.conversions_enabled')))
        throw new AppError('Currency conversion is currently unavailable', { status: 503, code: 'FX_DISABLED' });
      await assertVerified(prisma, auth.user.id);
      await assertCurrencies(from, to);
      await Promise.all([assertWalletActive(prisma, auth.user.id, from), assertWalletActive(prisma, auth.user.id, to)]);
      const { minor } = await parseAmount(prisma, amount, from);
      const spreadBps = await settings.get('fx.spread_bps');
      // Fee = amount × spread, rounded up, in integer arithmetic (no floating point).
      const fee = (minor * BigInt(spreadBps) + 9_999n) / 10_000n;
      const [rf, rt] = await Promise.all([latest(from), latest(to)]);
      const toMinor = convertMinor(minor - fee, rf.rate, rt.rate);
      if (toMinor <= 0n) throw new ValidationError([{ location: 'body', path: 'amount', message: 'The amount is too small to convert' }]);
      // Display rate: units of `to` per unit of `from`, 10 decimal places, before the fee.
      const mid = convertMinor(10n ** 10n, rf.rate, rt.rate)
        .toString()
        .padStart(11, '0');
      const midRate = `${mid.slice(0, -10)}.${mid.slice(-10)}`;
      const anchorRate = await prisma.exchangeRate.findFirst({
        where: { currency: from === ANCHOR ? to : from },
        orderBy: { asOf: 'desc' },
      });
      const q = await prisma.fxQuote.create({
        data: {
          userId: auth.user.id,
          fromCurrency: from,
          toCurrency: to,
          fromAmountMinor: minor,
          feeMinor: fee,
          toAmountMinor: toMinor,
          midRate,
          spreadBps,
          fromRateId: rf.id ?? anchorRate.id,
          toRateId: rt.id ?? anchorRate.id,
          expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
        },
      });
      return {
        id: q.id,
        from: { amountMinor: minor.toString(), currency: from },
        fee: { amountMinor: fee.toString(), currency: from },
        to: { amountMinor: toMinor.toString(), currency: to },
        rate: midRate,
        spreadBps,
        rateSource: provider.name,
        rateAsOf: (rf.id ? rf : rt).asOf,
        expiresAt: q.expiresAt,
      };
    },

    async convert(auth, quoteId, ctx) {
      const result = await runLedgerTx(prisma, async (tx) => {
        const q = await tx.fxQuote.findUnique({ where: { id: quoteId } });
        if (!q || q.userId !== auth.user.id) throw new NotFoundError('Quote not found');
        if (q.usedAt) throw new ConflictError('This quote was already used', 'QUOTE_USED');
        if (q.expiresAt < new Date()) throw new ConflictError('This quote has expired. Get a new quote.', 'QUOTE_EXPIRED');
        const { count } = await tx.fxQuote.updateMany({ where: { id: quoteId, usedAt: null }, data: { usedAt: new Date() } });
        if (count !== 1) throw new ConflictError('This quote was already used', 'QUOTE_USED');

        const fromWallet = await wallets.ensureWallet(tx, q.userId, q.fromCurrency);
        const toWallet = await wallets.ensureWallet(tx, q.userId, q.toCurrency);
        const [clearFrom, clearTo, feeIncome] = await Promise.all([
          ledger.systemAccount(tx, 'FX_CLEARING', q.fromCurrency),
          ledger.systemAccount(tx, 'FX_CLEARING', q.toCurrency),
          ledger.systemAccount(tx, 'FEE_INCOME_TRANSACTION', q.fromCurrency),
        ]);
        const id = randomUUID();
        const { entry } = await ledger.post(tx, {
          idempotencyKey: `fx-conversion:${q.id}`,
          type: 'FX_CONVERSION',
          description: `Converted ${toDecimalString(money(q.fromAmountMinor, q.fromCurrency))} ${q.fromCurrency} to ${toDecimalString(money(q.toAmountMinor, q.toCurrency))} ${q.toCurrency}`,
          referenceType: 'currency_conversion',
          referenceId: id,
          postedById: auth.user.id,
          lines: [
            { accountId: fromWallet.accounts.available.id, amountMinor: q.fromAmountMinor, memo: `Converted to ${q.toCurrency}` },
            { accountId: clearFrom.id, amountMinor: -(q.fromAmountMinor - q.feeMinor), memo: 'FX clearing' },
            ...(q.feeMinor > 0n ? [{ accountId: feeIncome.id, amountMinor: -q.feeMinor, memo: 'Conversion fee' }] : []),
            { accountId: clearTo.id, amountMinor: q.toAmountMinor, memo: 'FX clearing' },
            { accountId: toWallet.accounts.available.id, amountMinor: -q.toAmountMinor, memo: `Converted from ${q.fromCurrency}` },
          ],
        });
        const rate = await tx.exchangeRate.findUnique({ where: { id: q.fromCurrency === ANCHOR ? q.toRateId : q.fromRateId } });
        const c = await tx.currencyConversion.create({
          data: {
            id,
            userId: q.userId,
            quoteId: q.id,
            fromCurrency: q.fromCurrency,
            toCurrency: q.toCurrency,
            fromAmountMinor: q.fromAmountMinor,
            feeMinor: q.feeMinor,
            toAmountMinor: q.toAmountMinor,
            midRate: q.midRate,
            rateAsOf: rate?.asOf ?? q.createdAt,
            journalEntryId: entry.id,
          },
        });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'fx.converted',
            entityType: 'currency_conversion',
            entityId: c.id,
            metadata: { quoteId, from: q.fromCurrency, to: q.toCurrency },
            ...ctx,
          },
          tx,
        );
        return c;
      });
      return this.serializeConversion(result);
    },

    serializeConversion: (c) => ({
      id: c.id,
      from: { amountMinor: c.fromAmountMinor.toString(), currency: c.fromCurrency },
      fee: { amountMinor: c.feeMinor.toString(), currency: c.fromCurrency },
      to: { amountMinor: c.toAmountMinor.toString(), currency: c.toCurrency },
      rate: plain(c.midRate),
      rateAsOf: c.rateAsOf,
      createdAt: c.createdAt,
    }),

    async listConversions(userId, { page = 1, pageSize = 20 } = {}) {
      const where = userId ? { userId } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.currencyConversion.count({ where }),
        prisma.currencyConversion.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { user: { select: { email: true } } },
        }),
      ]);
      return {
        data: rows.map((c) => ({ ...this.serializeConversion(c), ...(userId ? {} : { user: c.user.email }) })),
        meta: { page, pageSize, total },
      };
    },

    /**
     * FX reconciliation per currency: the FX clearing balance must equal what conversions
     * paid out in that currency minus what they took in (net of fees). Each currency is
     * checked on its own; the net positions are what treasury has to square with a bank.
     */
    async positions() {
      const currencies = await prisma.currency.findMany({ orderBy: { code: 'asc' } });
      return Promise.all(
        currencies.map(async ({ code }) => {
          const [outAgg, inAgg, clearing] = await Promise.all([
            prisma.currencyConversion.aggregate({
              where: { fromCurrency: code },
              _sum: { fromAmountMinor: true, feeMinor: true },
              _count: true,
            }),
            prisma.currencyConversion.aggregate({ where: { toCurrency: code }, _sum: { toAmountMinor: true }, _count: true }),
            prisma.ledgerAccountBalance.aggregate({
              where: { account: { purpose: 'FX_CLEARING', currency: code } },
              _sum: { balanceMinor: true },
            }),
          ]);
          const tookIn = (outAgg._sum.fromAmountMinor ?? 0n) - (outAgg._sum.feeMinor ?? 0n);
          const paidOut = inAgg._sum.toAmountMinor ?? 0n;
          const expected = paidOut - tookIn;
          const actual = clearing._sum.balanceMinor ?? 0n;
          return {
            currency: code,
            conversionsOut: outAgg._count,
            conversionsIn: inAgg._count,
            receivedMinor: tookIn.toString(),
            paidOutMinor: paidOut.toString(),
            feesMinor: (outAgg._sum.feeMinor ?? 0n).toString(),
            clearingBalanceMinor: actual.toString(),
            expectedBalanceMinor: expected.toString(),
            reconciled: actual === expected,
          };
        }),
      );
    },

    /** Activating or deactivating a currency needs a second approver. GHS is the anchor and always on. */
    async proposeCurrencyStatus(auth, code, { active, reason }, ctx) {
      if (code === ANCHOR) throw new ConflictError('The anchor currency cannot be changed', 'ANCHOR_CURRENCY');
      const c = await prisma.currency.findUnique({ where: { code } });
      if (!c) throw new NotFoundError('Currency not found');
      if (c.isActive === active) throw new ConflictError(`${code} is already ${active ? 'active' : 'inactive'}`, 'NO_CHANGE');
      const r = await prisma.$transaction(async (tx) => {
        const open = await tx.approvalRequest.findFirst({
          where: { type: 'CURRENCY_STATUS', status: 'PENDING', payload: { path: ['code'], equals: code } },
        });
        if (open) throw new ConflictError('A change to this currency is already waiting for approval', 'ALREADY_PENDING');
        return approvals.create(
          tx,
          {
            type: 'CURRENCY_STATUS',
            payload: { code, active },
            summary: `${active ? 'Activate' : 'Deactivate'} ${code}`,
            reason,
            requestedById: auth.user.id,
          },
          ctx,
        );
      });
      return approvals.get(r.id);
    },

    registerApprovals() {
      approvals.register('CURRENCY_STATUS', {
        async apply(tx, { code, active }) {
          if (!active) {
            const held = await tx.ledgerAccountBalance.count({
              where: { balanceMinor: { not: 0 }, account: { currency: code, ownerUserId: { not: null } } },
            });
            if (held) throw new ConflictError(`${code} cannot be deactivated while customers hold balances in it`, 'BALANCES_HELD');
          }
          await tx.currency.update({ where: { code }, data: { isActive: active } });
          return { code, active };
        },
      });
    },
  };
}
