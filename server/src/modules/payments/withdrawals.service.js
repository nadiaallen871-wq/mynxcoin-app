import { randomUUID } from 'node:crypto';
import { createCipher, randomToken } from '../../utils/crypto.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { WithdrawalStates } from '../../utils/state-machine.js';
import { runLedgerTx } from '../ledger/ledger.service.js';
import { assertVerified, assertWalletActive, displayAmount, firstNameOf, parseAmount } from './payment-helpers.js';

const mask = (v) => {
  const s = String(v);
  return s.length <= 4 ? '••••' : `•••• ${s.slice(-4)}`;
};

/**
 * Withdrawals with mandatory review (maker = investor, checker = finance).
 *
 * Ledger flow (amount A, fee F):
 *   request   Dr 2000 customer available A    Cr 2100 withdrawals payable A   (funds committed at once)
 *   complete  Dr 2100 payable A               Cr 1100 payment clearing A−F, Cr 4010 fee income F
 *   reject / cancel / return   Dr 2100 payable A   Cr 2000 customer available A
 *
 * The payout destination is encrypted at rest. Only a masked form is shown.
 * Risk flags (velocity, size, new destination, recent deposit) are computed at request
 * time for the reviewer. They inform the decision and never auto-approve.
 */
export function createWithdrawalsService({
  prisma,
  env,
  ledger,
  wallets,
  provider,
  messaging,
  audit,
  logger,
  settings,
  monitoring = null,
}) {
  const cipher = createCipher(env.ENCRYPTION_KEY);

  const serialize = (w, { staff = false } = {}) => ({
    id: w.id,
    status: w.status,
    amount: { amountMinor: w.amountMinor.toString(), currency: w.currency },
    fee: { amountMinor: w.feeMinor.toString(), currency: w.currency },
    netAmount: { amountMinor: (w.amountMinor - w.feeMinor).toString(), currency: w.currency },
    method: w.method,
    destination: w.destinationMasked,
    failureReason: w.failureReason,
    createdAt: w.createdAt,
    decidedAt: w.decidedAt,
    completedAt: w.completedAt,
    ...(staff
      ? {
          riskFlags: w.riskFlags,
          reviewNote: w.reviewNote,
          reviewedBy: w.reviewedBy
            ? w.reviewedBy.profile
              ? `${w.reviewedBy.profile.firstName} ${w.reviewedBy.profile.lastName}`
              : w.reviewedBy.email
            : null,
          user: w.user && {
            id: w.user.id,
            email: w.user.email,
            name: w.user.profile ? `${w.user.profile.firstName} ${w.user.profile.lastName}` : null,
          },
        }
      : {}),
  });

  async function returnFunds(tx, w, { reason, actorId }) {
    const { accounts } = await wallets.ensureWallet(tx, w.userId, w.currency);
    const payable = await ledger.systemAccount(tx, 'WITHDRAWALS_PAYABLE', w.currency);
    const { entry } = await ledger.post(tx, {
      idempotencyKey: `withdrawal-return:${w.id}`,
      type: 'WITHDRAWAL_RETURN',
      description: `Withdrawal returned to wallet: ${reason}`.slice(0, 500),
      referenceType: 'withdrawal',
      referenceId: w.id,
      postedById: actorId,
      lines: [
        { accountId: payable.id, amountMinor: w.amountMinor, memo: 'Release payable' },
        { accountId: accounts.available.id, amountMinor: -w.amountMinor, memo: 'Returned to available' },
      ],
    });
    return entry;
  }

  async function notify(tx, w, template, vars = {}) {
    const user = await tx.user.findUnique({ where: { id: w.userId } });
    return messaging.queue(tx, {
      userId: w.userId,
      recipient: user.email,
      template,
      vars: {
        firstName: await firstNameOf(tx, w.userId),
        amount: displayAmount(w.amountMinor, w.currency),
        destination: w.destinationMasked,
        ...vars,
      },
    });
  }

  /** Conditional status move: only one concurrent caller can transition a given withdrawal. */
  async function move(tx, w, to, data = {}) {
    WithdrawalStates.assertTransition(w.status, to);
    const { count } = await tx.withdrawal.updateMany({ where: { id: w.id, status: w.status }, data: { status: to, ...data } });
    if (count !== 1) throw new ConflictError('This withdrawal was updated by someone else. Refresh and try again.', 'CONCURRENT_UPDATE');
    return { ...w, status: to, ...data };
  }

  async function complete(tx, w, actorId) {
    const payable = await ledger.systemAccount(tx, 'WITHDRAWALS_PAYABLE', w.currency);
    const clearing = await ledger.systemAccount(tx, 'PAYMENT_CLEARING', w.currency);
    const feeIncome = await ledger.systemAccount(tx, 'FEE_INCOME_TRANSACTION', w.currency);
    const { entry } = await ledger.post(tx, {
      idempotencyKey: `withdrawal-settle:${w.id}`,
      type: 'WITHDRAWAL',
      description: `Withdrawal paid out to ${w.destinationMasked}`,
      referenceType: 'withdrawal',
      referenceId: w.id,
      postedById: actorId,
      lines: [
        { accountId: payable.id, amountMinor: w.amountMinor, memo: 'Settle payable' },
        { accountId: clearing.id, amountMinor: -(w.amountMinor - w.feeMinor), memo: 'Paid out via provider' },
        ...(w.feeMinor > 0n ? [{ accountId: feeIncome.id, amountMinor: -w.feeMinor, memo: 'Withdrawal fee' }] : []),
      ],
    });
    return move(tx, w, 'COMPLETED', { settlementEntryId: entry.id, completedAt: new Date(), failureReason: null });
  }

  /** Sends the payout through the provider and applies the result. Runs after approval or on retry. */
  async function payout(w, actorId) {
    const destination = JSON.parse(cipher.decrypt(w.destinationEncrypted));
    const reference = `wd_${randomToken(12).replace(/[-_]/g, 'x')}`;
    const payment = await prisma.payment.create({
      data: {
        userId: w.userId,
        direction: 'OUTBOUND',
        provider: provider.name,
        reference,
        amountMinor: w.amountMinor - w.feeMinor,
        currency: w.currency,
        status: 'PENDING',
      },
    });
    await prisma.withdrawal.update({ where: { id: w.id }, data: { paymentId: payment.id } });
    let result;
    try {
      result = await provider.initiatePayout({ reference, amountMinor: w.amountMinor - w.feeMinor, currency: w.currency, destination });
    } catch (err) {
      logger.error({ err, withdrawalId: w.id }, 'payout initiation failed');
      result = { status: 'FAILED', failureReason: 'Provider unavailable' };
    }
    const messages = await runLedgerTx(prisma, async (tx) => {
      const current = await tx.withdrawal.findUnique({ where: { id: w.id } });
      if (result.status === 'SUCCEEDED') {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'SUCCEEDED', providerTransactionId: result.providerTransactionId, completedAt: new Date() },
        });
        await complete(tx, current, actorId);
        await audit.record(
          { actorId, action: 'withdrawal.completed', entityType: 'withdrawal', entityId: w.id, metadata: { reference } },
          tx,
        );
        return [await notify(tx, current, 'withdrawal-completed')];
      }
      if (result.status === 'FAILED') {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failureReason: result.failureReason, completedAt: new Date() },
        });
        await move(tx, current, 'FAILED', { failureReason: result.failureReason ?? 'Payout failed' });
        await audit.record(
          {
            actorId,
            action: 'withdrawal.payout_failed',
            entityType: 'withdrawal',
            entityId: w.id,
            metadata: { reference, reason: result.failureReason },
          },
          tx,
        );
        return [];
      }
      return []; // PENDING: the provider webhook (transfer.*) completes it.
    });
    await messaging.dispatch(messages);
  }

  async function load(id, tx = prisma) {
    const w = await tx.withdrawal.findUnique({ where: { id } });
    if (!w) throw new NotFoundError('Withdrawal not found');
    return w;
  }

  return {
    serialize,

    async request(auth, { amount, currency = 'GHS', method, destination }, ctx) {
      await assertVerified(prisma, auth.user.id);
      await assertWalletActive(prisma, auth.user.id, currency);
      const { minor } = await parseAmount(prisma, amount, currency);
      const fee = BigInt(await settings.get('payments.withdrawal_fee_minor'));
      const minimum = BigInt(await settings.get('payments.withdrawal_min_minor'));
      const large = BigInt(await settings.get('payments.large_withdrawal_minor'));
      if (minor < minimum)
        throw new AppError(`The minimum withdrawal is ${displayAmount(minimum, currency)}`, {
          status: 422,
          code: 'AMOUNT_OUT_OF_RANGE',
        });
      if (minor <= fee)
        throw new AppError('The amount must be greater than the withdrawal fee', { status: 422, code: 'AMOUNT_OUT_OF_RANGE' });

      // The payout account must be in the investor's verified name (the reviewer checks it against KYC).
      const masked = `${method === 'MOBILE_MONEY' ? destination.network : destination.bankCode} ${mask(destination.accountNumber)} (${destination.accountName})`;
      const since = new Date(Date.now() - 24 * 3_600_000);
      const [recentCount, priorToSame, recentDeposit] = await Promise.all([
        prisma.withdrawal.count({ where: { userId: auth.user.id, createdAt: { gt: since } } }),
        prisma.withdrawal.count({ where: { userId: auth.user.id, destinationMasked: masked, status: 'COMPLETED' } }),
        prisma.deposit.count({ where: { userId: auth.user.id, status: 'SUCCEEDED', completedAt: { gt: since } } }),
      ]);
      const riskFlags = [
        ...(recentCount >= 3 ? ['VELOCITY_24H'] : []),
        ...(minor >= large ? ['LARGE_AMOUNT'] : []),
        ...(priorToSame === 0 ? ['NEW_DESTINATION'] : []),
        ...(recentDeposit > 0 ? ['RECENT_DEPOSIT'] : []),
      ];

      const withdrawalId = randomUUID();
      const { withdrawal, message } = await runLedgerTx(prisma, async (tx) => {
        // Post first (funds are committed or the request fails with INSUFFICIENT_FUNDS), then record the withdrawal against the entry.
        const { accounts } = await wallets.ensureWallet(tx, auth.user.id, currency);
        const payable = await ledger.systemAccount(tx, 'WITHDRAWALS_PAYABLE', currency);
        const { entry } = await ledger.post(tx, {
          idempotencyKey: `withdrawal-request:${withdrawalId}`,
          type: 'WITHDRAWAL_REQUEST',
          description: `Withdrawal requested to ${masked}`,
          referenceType: 'withdrawal',
          referenceId: withdrawalId,
          postedById: auth.user.id,
          lines: [
            { accountId: accounts.available.id, amountMinor: minor, memo: 'Withdrawal requested' },
            { accountId: payable.id, amountMinor: -minor, memo: 'Committed for payout' },
          ],
        });
        const w = await tx.withdrawal.create({
          data: {
            id: withdrawalId,
            userId: auth.user.id,
            amountMinor: minor,
            feeMinor: fee,
            currency,
            method,
            destinationEncrypted: cipher.encrypt(JSON.stringify(destination)),
            destinationMasked: masked,
            riskFlags,
            requestEntryId: entry.id,
          },
        });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'withdrawal.requested',
            entityType: 'withdrawal',
            entityId: w.id,
            metadata: { amountMinor: minor, method, riskFlags },
            ...ctx,
          },
          tx,
        );
        return { withdrawal: w, message: await notify(tx, w, 'withdrawal-requested') };
      });
      await messaging.dispatch([message]);
      await monitoring?.onWithdrawalRequested(withdrawal.id);
      return serialize(withdrawal);
    },

    async cancel(auth, id, ctx) {
      const w = await load(id);
      if (w.userId !== auth.user.id) throw new NotFoundError('Withdrawal not found');
      const updated = await runLedgerTx(prisma, async (tx) => {
        const current = await load(id, tx);
        if (current.status !== 'REQUESTED') throw new ConflictError('Only withdrawals awaiting review can be cancelled', 'NOT_CANCELLABLE');
        const entry = await returnFunds(tx, current, { reason: 'cancelled by investor', actorId: auth.user.id });
        const moved = await move(tx, current, 'CANCELLED', { returnEntryId: entry.id, decidedAt: new Date() });
        await audit.record({ actorId: auth.user.id, action: 'withdrawal.cancelled', entityType: 'withdrawal', entityId: id, ...ctx }, tx);
        return moved;
      });
      return serialize(updated);
    },

    async approve(auth, id, { note }, ctx) {
      const w = await load(id);
      if (w.userId === auth.user.id) throw new ForbiddenError('You cannot approve your own withdrawal');
      const approved = await prisma.$transaction(async (tx) => {
        const current = await load(id, tx);
        const a = await move(tx, current, 'APPROVED', { reviewedById: auth.user.id, reviewNote: note ?? null, decidedAt: new Date() });
        const p = await move(tx, a, 'PROCESSING');
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'withdrawal.approved',
            entityType: 'withdrawal',
            entityId: id,
            metadata: { note, riskFlags: current.riskFlags },
            ...ctx,
          },
          tx,
        );
        return p;
      });
      await payout(approved, auth.user.id);
      return this.getForStaff(id);
    },

    async reject(auth, id, { note }, ctx) {
      const w = await load(id);
      if (w.userId === auth.user.id) throw new ForbiddenError('You cannot review your own withdrawal');
      const message = await runLedgerTx(prisma, async (tx) => {
        const current = await load(id, tx);
        if (current.status !== 'REQUESTED') throw new ConflictError('Only withdrawals awaiting review can be rejected', 'NOT_REJECTABLE');
        const entry = await returnFunds(tx, current, { reason: 'rejected at review', actorId: auth.user.id });
        await move(tx, current, 'REJECTED', {
          returnEntryId: entry.id,
          reviewedById: auth.user.id,
          reviewNote: note,
          decidedAt: new Date(),
        });
        await audit.record(
          { actorId: auth.user.id, action: 'withdrawal.rejected', entityType: 'withdrawal', entityId: id, metadata: { note }, ...ctx },
          tx,
        );
        return notify(tx, current, 'withdrawal-rejected');
      });
      await messaging.dispatch([message]);
      return this.getForStaff(id);
    },

    /** A failed payout can be retried or returned to the wallet. */
    async retry(auth, id, ctx) {
      const moved = await prisma.$transaction(async (tx) => {
        const current = await load(id, tx);
        const p = await move(tx, current, 'PROCESSING', { failureReason: null });
        await audit.record({ actorId: auth.user.id, action: 'withdrawal.retried', entityType: 'withdrawal', entityId: id, ...ctx }, tx);
        return p;
      });
      await payout(moved, auth.user.id);
      return this.getForStaff(id);
    },

    async returnToWallet(auth, id, { note }, ctx) {
      const message = await runLedgerTx(prisma, async (tx) => {
        const current = await load(id, tx);
        if (current.status !== 'FAILED') throw new ConflictError('Only failed payouts can be returned to the wallet', 'NOT_RETURNABLE');
        const entry = await returnFunds(tx, current, { reason: note ?? 'payout failed', actorId: auth.user.id });
        await move(tx, current, 'RETURNED', { returnEntryId: entry.id });
        await audit.record(
          { actorId: auth.user.id, action: 'withdrawal.returned', entityType: 'withdrawal', entityId: id, metadata: { note }, ...ctx },
          tx,
        );
        return notify(tx, current, 'withdrawal-rejected');
      });
      await messaging.dispatch([message]);
      return this.getForStaff(id);
    },

    async getForStaff(id) {
      const w = await prisma.withdrawal.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
          reviewedBy: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
        },
      });
      if (!w) throw new NotFoundError('Withdrawal not found');
      return serialize(w, { staff: true });
    },

    async listForUser(userId, { page = 1, pageSize = 20 } = {}) {
      const [total, rows] = await prisma.$transaction([
        prisma.withdrawal.count({ where: { userId } }),
        prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { data: rows.map((w) => serialize(w)), meta: { page, pageSize, total } };
    },

    async listAll({ status, page, pageSize }) {
      const where = status ? { status } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.withdrawal.count({ where }),
        prisma.withdrawal.findMany({
          where,
          include: {
            user: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
            reviewedBy: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
          },
          orderBy: { createdAt: status === 'REQUESTED' ? 'asc' : 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { data: rows.map((w) => serialize(w, { staff: true })), meta: { page, pageSize, total } };
    },
  };
}
