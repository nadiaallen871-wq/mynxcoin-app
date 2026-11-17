import { AppError, ConflictError, NotFoundError, UnauthorizedError } from '../../utils/errors.js';
import { randomToken } from '../../utils/crypto.js';
import { runLedgerTx } from '../ledger/ledger.service.js';
import { assertVerified, assertWalletActive, displayAmount, firstNameOf, parseAmount } from './payment-helpers.js';

const VERIFY_THROTTLE_MS = 5_000;

/**
 * Deposits through a payment provider.
 *
 *  initiate → Payment(PENDING) + Deposit(PENDING) → investor completes the hosted checkout
 *  → provider webhook (signature verified, event stored once) → **re-verify with the provider API**
 *  → credit the wallet in one transaction (conditional status update + ledger entry `deposit:<id>`).
 *
 * The browser's "payment successful" redirect is never trusted. The same settlement runs from
 * the webhook, from the return page's status refresh, and from the reconciliation job, and it is
 * idempotent, so a duplicated or lost webhook can never double-credit or strand a payment.
 */
export function createDepositsService({ prisma, env, ledger, wallets, provider, messaging, audit, logger, settings, monitoring = null }) {
  const serialize = (d) => ({
    id: d.id,
    status: d.status,
    amount: { amountMinor: d.amountMinor.toString(), currency: d.currency },
    fee: d.payment ? { amountMinor: d.payment.feeMinor.toString(), currency: d.currency } : null,
    reference: d.payment?.reference,
    provider: d.payment?.provider,
    checkoutUrl: d.status === 'PENDING' ? d.payment?.checkoutUrl : null,
    failureReason: d.payment?.failureReason ?? null,
    createdAt: d.createdAt,
    completedAt: d.completedAt,
  });

  async function settleCollection(reference) {
    const payment = await prisma.payment.findUnique({ where: { reference }, include: { deposit: true } });
    if (!payment || payment.direction !== 'INBOUND' || !payment.deposit) return { outcome: 'unknown' };
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(payment.status)) return { outcome: 'already-final', status: payment.status };

    const v = await provider.verifyCollection(reference);
    await prisma.payment.update({ where: { id: payment.id }, data: { lastVerifiedAt: new Date() } });
    if (v.status === 'PENDING') return { outcome: 'pending' };

    const deposit = payment.deposit;
    if (v.status === 'SUCCEEDED' && (v.amountMinor !== payment.amountMinor || v.currency !== payment.currency)) {
      // Never credit a different amount than requested. This needs human investigation.
      logger.error({ reference, expected: payment.amountMinor.toString(), received: String(v.amountMinor) }, 'PAYMENT AMOUNT MISMATCH');
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: { status: 'FAILED', failureReason: 'Amount or currency mismatch: held for investigation', completedAt: new Date() },
        });
        if (count) await tx.deposit.update({ where: { id: deposit.id }, data: { status: 'FAILED', completedAt: new Date() } });
        await audit.record(
          {
            action: 'payment.amount_mismatch',
            entityType: 'payment',
            entityId: payment.id,
            metadata: { reference, received: String(v.amountMinor), currency: v.currency },
          },
          tx,
        );
      });
      await monitoring?.raise({
        userId: payment.deposit.userId,
        rule: 'AMOUNT_MISMATCH',
        severity: 'HIGH',
        summary: 'Provider reported a different amount or currency for a deposit',
        referenceType: 'deposit',
        referenceId: payment.deposit.id,
        details: { reference },
      });
      return { outcome: 'mismatch' };
    }

    if (v.status === 'SUCCEEDED') {
      const fee = v.feeMinor ?? 0n;
      const message = await runLedgerTx(prisma, async (tx) => {
        // The conditional update is the idempotency gate: exactly one caller moves PENDING → SUCCEEDED.
        const { count } = await tx.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: {
            status: 'SUCCEEDED',
            feeMinor: fee,
            providerTransactionId: v.providerTransactionId ?? payment.providerTransactionId,
            completedAt: new Date(),
          },
        });
        if (count !== 1) return null;
        const { accounts } = await wallets.ensureWallet(tx, payment.userId, payment.currency);
        const clearing = await ledger.systemAccount(tx, 'PAYMENT_CLEARING', payment.currency);
        const charges = await ledger.systemAccount(tx, 'PROVIDER_CHARGES', payment.currency);
        const lines = [
          { accountId: clearing.id, amountMinor: payment.amountMinor - fee, memo: `Provider receivable ${reference}` },
          ...(fee > 0n ? [{ accountId: charges.id, amountMinor: fee, memo: 'Provider fee (borne by platform)' }] : []),
          { accountId: accounts.available.id, amountMinor: -payment.amountMinor, memo: 'Deposit' },
        ];
        const { entry } = await ledger.post(tx, {
          idempotencyKey: `deposit:${deposit.id}`,
          type: 'DEPOSIT',
          description: `Deposit via ${payment.provider} (${reference})`,
          referenceType: 'deposit',
          referenceId: deposit.id,
          lines,
        });
        await tx.deposit.update({
          where: { id: deposit.id },
          data: { status: 'SUCCEEDED', journalEntryId: entry.id, completedAt: new Date() },
        });
        await audit.record(
          {
            actorId: payment.userId,
            action: 'deposit.succeeded',
            entityType: 'deposit',
            entityId: deposit.id,
            metadata: { reference, amountMinor: payment.amountMinor, feeMinor: fee },
          },
          tx,
        );
        return messaging.queue(tx, {
          userId: payment.userId,
          recipient: (await tx.user.findUnique({ where: { id: payment.userId } })).email,
          template: 'deposit-received',
          vars: { firstName: await firstNameOf(tx, payment.userId), amount: displayAmount(payment.amountMinor, payment.currency) },
        });
      });
      if (message) await messaging.dispatch([message]);
      if (message) await monitoring?.onDepositCredited(payment.deposit.id);
      return { outcome: message ? 'credited' : 'already-final' };
    }

    const message = await prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'FAILED', failureReason: v.failureReason ?? 'Payment was not completed', completedAt: new Date() },
      });
      if (count !== 1) return null;
      await tx.deposit.update({ where: { id: deposit.id }, data: { status: 'FAILED', completedAt: new Date() } });
      await audit.record(
        {
          actorId: payment.userId,
          action: 'deposit.failed',
          entityType: 'deposit',
          entityId: deposit.id,
          metadata: { reference, reason: v.failureReason },
        },
        tx,
      );
      return messaging.queue(tx, {
        userId: payment.userId,
        recipient: (await tx.user.findUnique({ where: { id: payment.userId } })).email,
        template: 'payment-failed',
        vars: { firstName: await firstNameOf(tx, payment.userId), amount: displayAmount(payment.amountMinor, payment.currency) },
      });
    });
    if (message) await messaging.dispatch([message]);
    return { outcome: message ? 'failed' : 'already-final' };
  }

  return {
    serialize,
    settleCollection,

    async initiate(auth, { amount, currency = 'GHS' }, ctx) {
      await assertVerified(prisma, auth.user.id);
      await assertWalletActive(prisma, auth.user.id, currency);
      const { minor } = await parseAmount(prisma, amount, currency);
      // Limits are system settings (changed only with a second approver); env supplies the defaults.
      const min = BigInt(await settings.get('payments.deposit_min_minor'));
      const max = BigInt(await settings.get('payments.deposit_max_minor'));
      if (minor < min || minor > max) {
        throw new AppError(`Deposits must be between ${displayAmount(min, currency)} and ${displayAmount(max, currency)}`, {
          status: 422,
          code: 'AMOUNT_OUT_OF_RANGE',
        });
      }
      const reference = `dep_${randomToken(12).replace(/[-_]/g, 'x')}`;
      const deposit = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: { userId: auth.user.id, direction: 'INBOUND', provider: provider.name, reference, amountMinor: minor, currency },
        });
        const d = await tx.deposit.create({ data: { userId: auth.user.id, paymentId: payment.id, amountMinor: minor, currency } });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'deposit.initiated',
            entityType: 'deposit',
            entityId: d.id,
            metadata: { reference, amountMinor: minor, provider: provider.name },
            ...ctx,
          },
          tx,
        );
        return d;
      });

      try {
        const init = await provider.initializeCollection({
          reference,
          amountMinor: minor,
          currency,
          email: auth.user.email,
          callbackUrl: `${env.APP_BASE_URL}/app/deposits/${deposit.id}`,
        });
        await prisma.$transaction([
          prisma.payment.update({
            where: { reference },
            data: { status: 'PENDING', checkoutUrl: init.checkoutUrl, providerTransactionId: init.providerTransactionId },
          }),
          prisma.deposit.update({ where: { id: deposit.id }, data: { status: 'PENDING' } }),
        ]);
      } catch (err) {
        logger.error({ err, reference }, 'payment provider initialisation failed');
        await prisma.$transaction([
          prisma.payment.update({
            where: { reference },
            data: { status: 'FAILED', failureReason: 'Provider unavailable', completedAt: new Date() },
          }),
          prisma.deposit.update({ where: { id: deposit.id }, data: { status: 'FAILED', completedAt: new Date() } }),
        ]);
        throw new AppError('The payment provider is unavailable. Please try again shortly.', { status: 502, code: 'PROVIDER_UNAVAILABLE' });
      }
      return this.get(auth, deposit.id);
    },

    /** Investor view. A pending deposit is re-verified with the provider (throttled), which covers missed webhooks. */
    async get(auth, id, { refresh = false } = {}) {
      let d = await prisma.deposit.findFirst({ where: { id, userId: auth.user.id }, include: { payment: true } });
      if (!d) throw new NotFoundError('Deposit not found');
      const stale = !d.payment.lastVerifiedAt || Date.now() - d.payment.lastVerifiedAt.getTime() > VERIFY_THROTTLE_MS;
      if (refresh && d.status === 'PENDING' && stale) {
        await settleCollection(d.payment.reference).catch((err) =>
          logger.warn({ err, reference: d.payment.reference }, 'deposit verification failed'),
        );
        d = await prisma.deposit.findFirst({ where: { id }, include: { payment: true } });
      }
      return serialize(d);
    },

    /**
     * Provider webhook: verify the signature, store the event exactly once, then settle by
     * re-querying the provider. Returns quickly. Processing errors are recorded, and the
     * reconciliation job retries the payment.
     */
    async handleWebhook(providerName, { rawBody, headers }) {
      if (providerName !== provider.name) throw new NotFoundError('Unknown payment provider');
      const parsed = provider.parseWebhook({ rawBody, headers });
      if (!parsed.valid) {
        logger.warn({ provider: providerName }, 'SECURITY: payment webhook with invalid signature rejected');
        throw new UnauthorizedError('Invalid webhook signature');
      }
      let event;
      try {
        event = await prisma.paymentWebhookEvent.create({
          data: {
            provider: providerName,
            eventId: parsed.eventId,
            eventType: parsed.eventType,
            reference: parsed.reference,
            payload: parsed.payload,
          },
        });
      } catch (err) {
        if (err.code === 'P2002') return { duplicate: true };
        throw err;
      }
      try {
        const result = parsed.type === 'payout' ? { outcome: 'payout-handled-by-withdrawals' } : await settleCollection(parsed.reference);
        await prisma.paymentWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
        return { duplicate: false, type: parsed.type, reference: parsed.reference, ...result };
      } catch (err) {
        logger.error({ err, eventId: parsed.eventId }, 'webhook processing failed; reconciliation will retry');
        await prisma.paymentWebhookEvent.update({ where: { id: event.id }, data: { processingError: String(err.message).slice(0, 500) } });
        return { duplicate: false, type: parsed.type, reference: parsed.reference, outcome: 'error' };
      }
    },

    /** Sandbox only: the investor "pays" on the simulated hosted checkout, which emits a signed webhook. */
    async simulateSandboxCheckout(auth, reference, outcome) {
      if (env.PLATFORM_MODE !== 'sandbox' || provider.name !== 'sandbox') throw new NotFoundError('Not available');
      const payment = await prisma.payment.findFirst({ where: { reference, userId: auth.user.id } });
      if (!payment) throw new NotFoundError('Checkout not found');
      if (payment.status !== 'PENDING') throw new ConflictError('This checkout is already complete', 'CHECKOUT_COMPLETE');
      const webhook = await provider.simulateCheckout(reference, outcome);
      if (webhook) await this.handleWebhook('sandbox', webhook);
      const d = await prisma.deposit.findFirst({ where: { paymentId: payment.id }, include: { payment: true } });
      return serialize(d);
    },

    async sandboxCheckoutInfo(auth, reference) {
      if (env.PLATFORM_MODE !== 'sandbox' || provider.name !== 'sandbox') throw new NotFoundError('Not available');
      const payment = await prisma.payment.findFirst({ where: { reference, userId: auth.user.id }, include: { deposit: true } });
      if (!payment) throw new NotFoundError('Checkout not found');
      return {
        reference,
        amount: { amountMinor: payment.amountMinor.toString(), currency: payment.currency },
        status: payment.status,
        depositId: payment.deposit?.id,
      };
    },

    /** Payment reconciliation: settles payments still pending after `olderThanMs` by asking the provider. */
    async reconcilePending({ olderThanMs = 120_000, limit = 100 } = {}) {
      const pending = await prisma.payment.findMany({
        where: { direction: 'INBOUND', status: 'PENDING', createdAt: { lt: new Date(Date.now() - olderThanMs) } },
        select: { reference: true },
        take: limit,
        orderBy: { createdAt: 'asc' },
      });
      const results = { checked: pending.length, credited: 0, failed: 0, pending: 0, errors: 0 };
      for (const p of pending) {
        try {
          const r = await settleCollection(p.reference);
          if (r.outcome === 'credited') results.credited += 1;
          else if (r.outcome === 'failed' || r.outcome === 'mismatch') results.failed += 1;
          else if (r.outcome === 'pending') results.pending += 1;
        } catch (err) {
          results.errors += 1;
          logger.warn({ err, reference: p.reference }, 'pending payment check failed');
        }
      }
      return results;
    },

    async listForUser(userId, { page = 1, pageSize = 20 } = {}) {
      const [total, rows] = await prisma.$transaction([
        prisma.deposit.count({ where: { userId } }),
        prisma.deposit.findMany({
          where: { userId },
          include: { payment: true },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { data: rows.map(serialize), meta: { page, pageSize, total } };
    },

    async listAll({ status, page, pageSize }) {
      const where = status ? { status } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.deposit.count({ where }),
        prisma.deposit.findMany({
          where,
          include: { payment: true, user: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        data: rows.map((d) => ({
          ...serialize(d),
          user: { email: d.user.email, name: d.user.profile ? `${d.user.profile.firstName} ${d.user.profile.lastName}` : null },
        })),
        meta: { page, pageSize, total },
      };
    },
  };
}
