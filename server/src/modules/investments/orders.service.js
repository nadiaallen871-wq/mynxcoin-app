import { Prisma } from '@prisma/client';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { RoundingMode, accrue, money, multiplyByRate, toDecimalString } from '../../utils/money.js';
import { InvestmentOrderStates } from '../../utils/state-machine.js';
import { runLedgerTx } from '../ledger/ledger.service.js';
import { RISK_PROFILE_ORDER } from '../onboarding/onboarding.constants.js';
import { assertVerified, assertWalletActive, displayAmount, firstNameOf, parseAmount } from '../payments/payment-helpers.js';
import { availabilityOf } from './products.service.js';

const OPEN_STATUSES = ['PENDING', 'CONFIRMED', 'ACTIVE', 'PARTIALLY_REDEEMED', 'REDEMPTION_PENDING'];
const DAY_MS = 86_400_000;
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

/**
 * Investment engine.
 *
 *  place    checks → reserve funds (2000 → 2010) → order PENDING, tied to the published product version
 *  confirm  staff record the custodian/issuer allocation reference →
 *           Dr 2010 reserved A, Cr 2300 holdings A−F, Cr 4010 fee F → order CONFIRMED → ACTIVE, holding created
 *  reject / cancel   release the reservation (2010 → 2000)
 *  maturity  daily job marks due holdings. Staff settle with the **actual proceeds** reported by the
 *           custodian: Dr 2300 principal, Cr 2000 proceeds − management fee, Cr 4000 management fee,
 *           and the difference against 1010 client money (income received, or a shortfall).
 *
 * Returns are never assumed: maturity proceeds are always entered from the custodian's figures.
 * Every step is atomic (status change, ledger entry and audit in one transaction) and uses
 * conditional updates, so concurrent clicks cannot double-confirm or double-release.
 */
export function createOrdersService({ prisma, ledger, wallets, messaging, audit, onInvestmentConfirmed = null }) {
  const person = (u) => (u ? (u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u.email) : null);
  const include = {
    product: { select: { id: true, slug: true, name: true, productType: true, termDays: true, returnType: true } },
    allocation: true,
    holding: true,
    user: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
    decidedBy: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
  };
  const serialize = (o, { staff = false } = {}) => ({
    id: o.id,
    orderNumber: o.orderNumber.toString(),
    status: o.status,
    product: o.product,
    productVersion: o.productVersion,
    amount: { amountMinor: o.amountMinor.toString(), currency: o.currency },
    fee: { amountMinor: o.feeMinor.toString(), currency: o.currency },
    invested: { amountMinor: (o.amountMinor - o.feeMinor).toString(), currency: o.currency },
    unsuitableAcknowledged: o.unsuitableAcknowledged,
    allocation: o.allocation && { custodianReference: o.allocation.custodianReference, allocatedAt: o.allocation.allocatedAt },
    holding: o.holding && serializeHolding(o.holding),
    decisionNote: o.decisionNote,
    createdAt: o.createdAt,
    confirmedAt: o.confirmedAt,
    closedAt: o.closedAt,
    ...(staff
      ? {
          investor: o.user && { id: o.user.id, email: o.user.email, name: person(o.user) },
          investorRiskProfile: o.investorRiskProfile,
          decidedBy: person(o.decidedBy),
        }
      : {}),
  });
  const serializeHolding = (h) => ({
    id: h.id,
    status: h.status,
    principal: { amountMinor: h.principalMinor.toString(), currency: h.currency },
    startDate: h.startDate.toISOString().slice(0, 10),
    maturityDate: h.maturityDate ? h.maturityDate.toISOString().slice(0, 10) : null,
    proceeds: h.proceedsMinor !== null ? { amountMinor: h.proceedsMinor.toString(), currency: h.currency } : null,
    managementFee: h.managementFeeMinor !== null ? { amountMinor: h.managementFeeMinor.toString(), currency: h.currency } : null,
    maturedAt: h.maturedAt,
    product: h.product,
    rollover: h.rollover,
    rolloverConsentAt: h.rolloverConsentAt,
    rolloverOrderId: h.rolloverOrderId,
    rolloverNote: h.rolloverNote,
  });

  async function move(tx, o, to, data = {}) {
    InvestmentOrderStates.assertTransition(o.status, to);
    const { count } = await tx.investmentOrder.updateMany({ where: { id: o.id, status: o.status }, data: { status: to, ...data } });
    if (count !== 1) throw new ConflictError('This order was updated by someone else. Refresh and try again.', 'CONCURRENT_UPDATE');
    return { ...o, status: to, ...data };
  }

  async function notify(tx, o, template, extra = {}) {
    const user = await tx.user.findUnique({ where: { id: o.userId } });
    const product = await tx.investmentProduct.findUnique({ where: { id: o.productId }, select: { name: true } });
    return messaging.queue(tx, {
      userId: o.userId,
      recipient: user.email,
      template,
      vars: {
        firstName: await firstNameOf(tx, o.userId),
        amount: displayAmount(o.amountMinor, o.currency),
        product: product.name,
        ...extra,
      },
    });
  }

  async function release(tx, o, { actorId, reason }) {
    const { entry } = await wallets.release(tx, {
      userId: o.userId,
      currency: o.currency,
      amountMinor: o.amountMinor,
      idempotencyKey: `order-release:${o.id}`,
      description: `Order #${o.orderNumber} ${reason}: funds released`,
      referenceType: 'investment_order',
      referenceId: o.id,
      postedById: actorId,
    });
    return entry;
  }

  return {
    serialize,

    async place(auth, { productSlug, amount, acceptRiskDisclosure, acknowledgeUnsuitable = false }, ctx) {
      if (acceptRiskDisclosure !== true)
        throw new ValidationError([
          { location: 'body', path: 'acceptRiskDisclosure', message: 'Confirm you have read the risk disclosure', code: 'required' },
        ]);
      await assertVerified(prisma, auth.user.id);
      const product = await prisma.investmentProduct.findUnique({ where: { slug: productSlug } });
      if (!product || !['PUBLISHED', 'CLOSED'].includes(product.status)) throw new NotFoundError('Investment not found');
      if (availabilityOf(product) !== 'OPEN') throw new ConflictError('This investment is not open for subscription', 'NOT_OPEN');
      if (!product.eligibleInvestorTypes.includes(auth.user.type))
        throw new ForbiddenError('This investment is not available to your account type');
      await assertWalletActive(prisma, auth.user.id, product.currency);

      const { minor } = await parseAmount(prisma, amount, product.currency);
      if (minor < product.minInvestmentMinor)
        throw new AppError(`The minimum investment is ${displayAmount(product.minInvestmentMinor, product.currency)}`, {
          status: 422,
          code: 'BELOW_MINIMUM',
        });
      if (product.incrementMinor && minor % product.incrementMinor !== 0n)
        throw new AppError(`Amounts must be in multiples of ${displayAmount(product.incrementMinor, product.currency)}`, {
          status: 422,
          code: 'INVALID_INCREMENT',
        });

      const risk = await prisma.riskAssessment.findFirst({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' } });
      if (!risk) throw new ConflictError('Complete the risk questionnaire before investing', 'RISK_ASSESSMENT_REQUIRED');
      const suitable = RISK_PROFILE_ORDER.indexOf(risk.riskProfile) >= RISK_PROFILE_ORDER.indexOf(product.minRiskProfile);
      if (!suitable && !acknowledgeUnsuitable) {
        throw new ConflictError(
          'This investment is riskier than your risk profile. Confirm that you understand before continuing.',
          'UNSUITABLE_ACK_REQUIRED',
        );
      }
      const fee = multiplyByRate(money(minor, product.currency), product.entryFeeRate.toString(), RoundingMode.UP).minor;

      const { order, message } = await runLedgerTx(prisma, async (tx) => {
        // Lock the product row so capacity and per-investor limits are checked against a stable total.
        await tx.$queryRaw`SELECT id FROM investment_products WHERE id = ${product.id}::uuid FOR UPDATE`;
        const fresh = await tx.investmentProduct.findUnique({ where: { id: product.id } });
        if (fresh.status !== 'PUBLISHED' || fresh.version !== product.version)
          throw new ConflictError('The product terms changed. Review them and try again.', 'PRODUCT_CHANGED');
        const [all, mine] = await Promise.all([
          tx.investmentOrder.aggregate({ where: { productId: product.id, status: { in: OPEN_STATUSES } }, _sum: { amountMinor: true } }),
          tx.investmentOrder.aggregate({
            where: { productId: product.id, userId: auth.user.id, status: { in: OPEN_STATUSES } },
            _sum: { amountMinor: true },
          }),
        ]);
        if (fresh.capacityMinor && (all._sum.amountMinor ?? 0n) + minor > fresh.capacityMinor)
          throw new ConflictError('This investment does not have enough capacity left for that amount', 'CAPACITY_EXCEEDED');
        if (fresh.maxInvestmentMinor && (mine._sum.amountMinor ?? 0n) + minor > fresh.maxInvestmentMinor) {
          throw new AppError(
            `The maximum per investor is ${displayAmount(fresh.maxInvestmentMinor, fresh.currency)} (including your existing orders)`,
            { status: 422, code: 'ABOVE_MAXIMUM' },
          );
        }
        const created = await tx.investmentOrder.create({
          data: {
            userId: auth.user.id,
            productId: product.id,
            productVersion: fresh.version,
            amountMinor: minor,
            feeMinor: fee,
            currency: product.currency,
            status: 'DRAFT',
            riskDisclosureAccepted: true,
            unsuitableAcknowledged: !suitable,
            investorRiskProfile: risk.riskProfile,
          },
        });
        const { entry } = await wallets.reserve(tx, {
          userId: auth.user.id,
          currency: product.currency,
          amountMinor: minor,
          idempotencyKey: `order-reserve:${created.id}`,
          description: `Order #${created.orderNumber}: ${product.name}`,
          referenceType: 'investment_order',
          referenceId: created.id,
          postedById: auth.user.id,
        });
        const pending = await move(tx, created, 'PENDING', { reserveEntryId: entry.id });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'order.placed',
            entityType: 'investment_order',
            entityId: created.id,
            metadata: {
              product: product.slug,
              version: fresh.version,
              amountMinor: minor,
              feeMinor: fee,
              unsuitableAcknowledged: !suitable,
            },
            ...ctx,
          },
          tx,
        );
        return { order: pending, message: await notify(tx, pending, 'investment-submitted') };
      });
      await messaging.dispatch([message]);
      return this.getForUser(auth, order.id);
    },

    async cancel(auth, id, ctx) {
      const message = await runLedgerTx(prisma, async (tx) => {
        const o = await tx.investmentOrder.findFirst({ where: { id, userId: auth.user.id } });
        if (!o) throw new NotFoundError('Order not found');
        if (o.status !== 'PENDING') throw new ConflictError('Only orders that are still pending can be cancelled', 'NOT_CANCELLABLE');
        const entry = await release(tx, o, { actorId: auth.user.id, reason: 'cancelled' });
        await move(tx, o, 'CANCELLED', { releaseEntryId: entry.id, closedAt: new Date() });
        await audit.record({ actorId: auth.user.id, action: 'order.cancelled', entityType: 'investment_order', entityId: id, ...ctx }, tx);
        return null;
      });
      await messaging.dispatch([message]);
      return this.getForUser(auth, id);
    },

    async reject(auth, id, { note }, ctx) {
      const message = await runLedgerTx(prisma, async (tx) => {
        const o = await tx.investmentOrder.findUnique({ where: { id } });
        if (!o) throw new NotFoundError('Order not found');
        if (o.userId === auth.user.id) throw new ForbiddenError('You cannot decide on your own order');
        if (o.status !== 'PENDING') throw new ConflictError('Only pending orders can be rejected', 'NOT_PENDING');
        const entry = await release(tx, o, { actorId: auth.user.id, reason: 'rejected' });
        await move(tx, o, 'REJECTED', { releaseEntryId: entry.id, decidedById: auth.user.id, decisionNote: note, closedAt: new Date() });
        await audit.record(
          { actorId: auth.user.id, action: 'order.rejected', entityType: 'investment_order', entityId: id, metadata: { note }, ...ctx },
          tx,
        );
        return notify(tx, o, 'investment-rejected');
      });
      await messaging.dispatch([message]);
      return this.getForStaff(id);
    },

    /** Records the allocation (custodian/issuer reference), posts the confirmation and opens the holding. */
    async confirm(auth, id, { custodianReference, notes }, ctx) {
      const result = await runLedgerTx(prisma, async (tx) => {
        const o = await tx.investmentOrder.findUnique({ where: { id }, include: { product: true } });
        if (!o) throw new NotFoundError('Order not found');
        if (o.userId === auth.user.id) throw new ForbiddenError('You cannot decide on your own order');
        if (o.status !== 'PENDING') throw new ConflictError('Only pending orders can be confirmed', 'NOT_PENDING');
        const principal = o.amountMinor - o.feeMinor;
        const { accounts } = await wallets.ensureWallet(tx, o.userId, o.currency);
        const holdingsAccount = await ledger.systemAccount(tx, 'CUSTOMER_HOLDINGS', o.currency);
        const feeIncome = await ledger.systemAccount(tx, 'FEE_INCOME_TRANSACTION', o.currency);
        const { entry } = await ledger.post(tx, {
          idempotencyKey: `order-confirm:${o.id}`,
          type: 'INVESTMENT_CONFIRMATION',
          description: `Order #${o.orderNumber} confirmed: ${o.product.name}`,
          referenceType: 'investment_order',
          referenceId: o.id,
          postedById: auth.user.id,
          lines: [
            { accountId: accounts.reserved.id, amountMinor: o.amountMinor, memo: 'Reserved funds applied' },
            { accountId: holdingsAccount.id, amountMinor: -principal, memo: `Holding: ${o.product.slug}` },
            ...(o.feeMinor > 0n ? [{ accountId: feeIncome.id, amountMinor: -o.feeMinor, memo: 'Entry fee' }] : []),
          ],
        });
        await tx.investmentAllocation.create({
          data: { orderId: o.id, principalMinor: principal, custodianReference, notes: notes ?? null, allocatedById: auth.user.id },
        });
        const start = today();
        const maturityDate =
          o.product.maturityDate && o.product.maturityDate > start
            ? o.product.maturityDate
            : o.product.termDays
              ? new Date(start.getTime() + o.product.termDays * DAY_MS)
              : null;
        await tx.investmentHolding.create({
          data: {
            userId: o.userId,
            productId: o.productId,
            orderId: o.id,
            principalMinor: principal,
            currency: o.currency,
            startDate: start,
            maturityDate,
          },
        });
        // PENDING → PROCESSING → CONFIRMED → ACTIVE, recorded in one transaction.
        const processing = await move(tx, o, 'PROCESSING');
        const confirmed = await move(tx, processing, 'CONFIRMED', {
          confirmEntryId: entry.id,
          decidedById: auth.user.id,
          confirmedAt: new Date(),
          decisionNote: notes ?? null,
        });
        await move(tx, confirmed, 'ACTIVE');
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'order.confirmed',
            entityType: 'investment_order',
            entityId: id,
            metadata: { custodianReference, principalMinor: principal },
            ...ctx,
          },
          tx,
        );
        return { message: await notify(tx, o, 'investment-confirmed'), investorId: o.userId };
      });
      await messaging.dispatch([result.message]);
      // Referral rewards depend on confirmed investments. The hook never throws.
      if (onInvestmentConfirmed) await onInvestmentConfirmed(result.investorId);
      return this.getForStaff(id);
    },

    /** Daily job: flags holdings whose maturity date has arrived, so staff can settle them with actual proceeds. */
    async flagMaturities() {
      const { count } = await prisma.investmentHolding.updateMany({
        where: { status: 'ACTIVE', maturityDate: { lte: today() } },
        data: { status: 'MATURITY_DUE' },
      });
      return { flagged: count };
    },

    async settleMaturity(auth, holdingId, { proceeds, custodianReference }, ctx) {
      const message = await runLedgerTx(prisma, async (tx) => {
        await tx.$queryRaw`SELECT id FROM investment_holdings WHERE id = ${holdingId}::uuid FOR UPDATE`;
        const h = await tx.investmentHolding.findUnique({ where: { id: holdingId }, include: { order: true, product: true } });
        if (!h) throw new NotFoundError('Holding not found');
        if (h.userId === auth.user.id) throw new ForbiddenError('You cannot settle your own holding');
        if (h.status !== 'MATURITY_DUE') throw new ConflictError('Only holdings that have reached maturity can be settled', 'NOT_DUE');
        const { minor: proceedsMinor } = await parseAmount(prisma, proceeds, h.currency, 'proceeds');

        // Management fee per the product version the investor subscribed to, over the actual holding period, capped at the proceeds.
        const version = await tx.productVersion.findUnique({
          where: { productId_version: { productId: h.productId, version: h.order.productVersion } },
        });
        // Snapshot decimals may serialise in exponent form, so normalise to a plain decimal string for exact parsing.
        // eslint-disable-next-line no-restricted-properties
        const rate = new Prisma.Decimal(String(version?.snapshot?.managementFeeRate ?? '0')).toFixed();
        const days = Math.max(0, Math.round((today().getTime() - h.startDate.getTime()) / DAY_MS));
        let mgmtFee = accrue(money(h.principalMinor, h.currency), rate, days, RoundingMode.UP).minor;
        if (mgmtFee > proceedsMinor) mgmtFee = proceedsMinor;

        const { accounts } = await wallets.ensureWallet(tx, h.userId, h.currency);
        const holdingsAccount = await ledger.systemAccount(tx, 'CUSTOMER_HOLDINGS', h.currency);
        const clientMoney = await ledger.systemAccount(tx, 'CLIENT_MONEY_BANK', h.currency);
        const mgmtIncome = await ledger.systemAccount(tx, 'FEE_INCOME_MANAGEMENT', h.currency);
        const difference = proceedsMinor - h.principalMinor;
        const lines = [
          { accountId: holdingsAccount.id, amountMinor: h.principalMinor, memo: 'Holding closed at maturity' },
          ...(difference !== 0n
            ? [
                {
                  accountId: clientMoney.id,
                  amountMinor: difference,
                  memo: difference > 0n ? 'Income received from custodian' : 'Shortfall against principal',
                },
              ]
            : []),
          ...(proceedsMinor - mgmtFee > 0n
            ? [{ accountId: accounts.available.id, amountMinor: -(proceedsMinor - mgmtFee), memo: 'Maturity proceeds' }]
            : []),
          ...(mgmtFee > 0n ? [{ accountId: mgmtIncome.id, amountMinor: -mgmtFee, memo: 'Management fee' }] : []),
        ];
        const { entry } = await ledger.post(tx, {
          idempotencyKey: `holding-mature:${h.id}`,
          type: 'MATURITY',
          description: `Maturity: ${h.product.name} (custodian ref ${custodianReference})`,
          referenceType: 'investment_holding',
          referenceId: h.id,
          postedById: auth.user.id,
          lines,
        });
        await tx.investmentHolding.update({
          where: { id: h.id },
          data: {
            status: 'MATURED',
            proceedsMinor,
            managementFeeMinor: mgmtFee,
            custodianReference,
            settlementEntryId: entry.id,
            settledById: auth.user.id,
            maturedAt: new Date(),
          },
        });
        await move(tx, h.order, 'MATURED', { closedAt: new Date() });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'holding.matured',
            entityType: 'investment_holding',
            entityId: h.id,
            metadata: { proceedsMinor, managementFeeMinor: mgmtFee, custodianReference, days },
            ...ctx,
          },
          tx,
        );
        return notify(tx, h.order, 'investment-matured', { proceeds: displayAmount(proceedsMinor - mgmtFee, h.currency) });
      });
      await messaging.dispatch([message]);
      await this.rolloverAfterMaturity(holdingId);
      const h = await prisma.investmentHolding.findUnique({
        where: { id: holdingId },
        include: { product: { select: { slug: true, name: true } } },
      });
      return serializeHolding(h);
    },

    /**
     * Standing instruction to reinvest a holding's proceeds into the same product at maturity.
     * Consent is tied to the product terms version shown now; if the terms change before
     * maturity, nothing is reinvested and the proceeds stay in the wallet.
     */
    async setRollover(auth, holdingId, { enabled, acceptRiskDisclosure }, ctx) {
      const h = await prisma.investmentHolding.findUnique({ where: { id: holdingId }, include: { product: true } });
      if (!h || h.userId !== auth.user.id) throw new NotFoundError('Holding not found');
      if (h.status !== 'ACTIVE') throw new ConflictError('Reinvestment can only be changed before maturity', 'NOT_ACTIVE');
      if (!h.maturityDate) throw new ConflictError('Open-ended investments do not mature', 'NO_MATURITY');
      if (enabled && acceptRiskDisclosure !== true) {
        throw new ValidationError([
          {
            location: 'body',
            path: 'acceptRiskDisclosure',
            message: 'Confirm you have read the current risk disclosure',
            code: 'required',
          },
        ]);
      }
      const data = enabled
        ? { rollover: true, rolloverVersion: h.product.version, rolloverConsentAt: new Date(), rolloverNote: null }
        : { rollover: false, rolloverVersion: null, rolloverConsentAt: null, rolloverNote: null };
      await prisma.$transaction(async (tx) => {
        await tx.investmentHolding.update({ where: { id: holdingId }, data });
        await audit.record(
          {
            actorId: auth.user.id,
            action: enabled ? 'holding.rollover_requested' : 'holding.rollover_cancelled',
            entityType: 'investment_holding',
            entityId: holdingId,
            metadata: { productVersion: h.product.version },
            ...ctx,
          },
          tx,
        );
      });
      const updated = await prisma.investmentHolding.findUnique({
        where: { id: holdingId },
        include: { product: { select: { slug: true, name: true } } },
      });
      return serializeHolding(updated);
    },

    /** Runs after a maturity settles. Never throws: the outcome is recorded on the holding. */
    async rolloverAfterMaturity(holdingId) {
      const h = await prisma.investmentHolding.findUnique({
        where: { id: holdingId },
        include: { product: true, order: true, user: { select: { type: true } } },
      });
      if (!h?.rollover || h.rolloverOrderId || h.status !== 'MATURED') return null;
      const note = (text) => prisma.investmentHolding.update({ where: { id: holdingId }, data: { rolloverNote: text.slice(0, 300) } });
      if (h.product.version !== h.rolloverVersion)
        return note('Not reinvested: the product terms changed after you asked. The proceeds are in your wallet.');
      let minor = h.proceedsMinor - (h.managementFeeMinor ?? 0n);
      if (h.product.incrementMinor) minor -= minor % h.product.incrementMinor;
      if (h.product.maxInvestmentMinor && minor > h.product.maxInvestmentMinor) minor = h.product.maxInvestmentMinor;
      try {
        const order = await this.place(
          { user: { id: h.userId, type: h.user.type } },
          {
            productSlug: h.product.slug,
            amount: toDecimalString(money(minor, h.currency)),
            acceptRiskDisclosure: true,
            acknowledgeUnsuitable: h.order.unsuitableAcknowledged,
          },
          { ip: null, userAgent: 'standing-instruction:rollover', requestId: null },
        );
        await prisma.investmentHolding.update({
          where: { id: holdingId },
          data: { rolloverOrderId: order.id, rolloverNote: `Reinvested in order #${order.orderNumber}` },
        });
        return order;
      } catch (err) {
        return note(`Not reinvested: ${err.message} The proceeds are in your wallet.`);
      }
    },

    async getForUser(auth, id) {
      const o = await prisma.investmentOrder.findFirst({ where: { id, userId: auth.user.id }, include });
      if (!o) throw new NotFoundError('Order not found');
      return serialize(o);
    },

    async getForStaff(id) {
      const o = await prisma.investmentOrder.findUnique({ where: { id }, include });
      if (!o) throw new NotFoundError('Order not found');
      return serialize(o, { staff: true });
    },

    async listForUser(auth, { page = 1, pageSize = 20 } = {}) {
      const where = { userId: auth.user.id };
      const [total, rows] = await prisma.$transaction([
        prisma.investmentOrder.count({ where }),
        prisma.investmentOrder.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { data: rows.map((o) => serialize(o)), meta: { page, pageSize, total } };
    },

    /** Investor portfolio: holdings with principal totals per currency (valuation and performance arrive in Phase 7). */
    async portfolio(auth) {
      const holdings = await prisma.investmentHolding.findMany({
        where: { userId: auth.user.id },
        include: { product: { select: { slug: true, name: true, productType: true, returnType: true, riskLevel: true } } },
        orderBy: [{ status: 'asc' }, { maturityDate: 'asc' }],
      });
      const totals = {};
      for (const h of holdings.filter((x) => x.status !== 'MATURED')) totals[h.currency] = (totals[h.currency] ?? 0n) + h.principalMinor;
      const pendingOrders = await prisma.investmentOrder.aggregate({
        where: { userId: auth.user.id, status: 'PENDING' },
        _sum: { amountMinor: true },
        _count: true,
      });
      return {
        holdings: holdings.map(serializeHolding),
        investedPrincipal: Object.entries(totals).map(([currency, minor]) => ({ amountMinor: minor.toString(), currency })),
        pendingOrders: { count: pendingOrders._count, amountMinor: (pendingOrders._sum.amountMinor ?? 0n).toString() },
      };
    },

    async listAll({ status, page, pageSize }) {
      const where = status ? { status } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.investmentOrder.count({ where }),
        prisma.investmentOrder.findMany({
          where,
          include,
          orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { data: rows.map((o) => serialize(o, { staff: true })), meta: { page, pageSize, total } };
    },

    async listDueHoldings() {
      const rows = await prisma.investmentHolding.findMany({
        where: { status: 'MATURITY_DUE' },
        include: {
          product: { select: { slug: true, name: true } },
          user: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { maturityDate: 'asc' },
      });
      return rows.map((h) => ({ ...serializeHolding(h), investor: { email: h.user.email, name: person(h.user) } }));
    },
  };
}
