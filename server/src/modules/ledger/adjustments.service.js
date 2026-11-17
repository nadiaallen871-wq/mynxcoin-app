import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { fromDecimalString } from '../../utils/money.js';
import { runLedgerTx } from './ledger.service.js';

/**
 * Maker-checker manual wallet adjustments. A Finance Officer proposes and a
 * different authorised person approves. Nothing touches the ledger until approval.
 * The approval posts one journal entry against the "Manual adjustments" account (3900),
 * so every adjustment is visible in the trial balance and the audit trail.
 * In sandbox mode this is also how test funds reach a wallet before payment
 * providers are connected (Phase 6).
 */
export function createAdjustmentsService({ prisma, ledger, wallets, audit }) {
  const person = (u) => (u ? (u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u.email) : null);
  const include = {
    customer: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
    requestedBy: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
    decidedBy: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
  };
  const serialize = (a) => ({
    id: a.id,
    customer: { id: a.customer.id, email: a.customer.email, name: person(a.customer) },
    currency: a.currency,
    direction: a.direction,
    amount: { amountMinor: a.amountMinor.toString(), currency: a.currency },
    reason: a.reason,
    status: a.status,
    requestedBy: { id: a.requestedBy.id, name: person(a.requestedBy) },
    decidedBy: a.decidedBy && { id: a.decidedBy.id, name: person(a.decidedBy) },
    decisionNote: a.decisionNote,
    decidedAt: a.decidedAt,
    journalEntryId: a.journalEntryId,
    createdAt: a.createdAt,
  });

  async function load(tx, id) {
    const a = await tx.ledgerAdjustment.findUnique({ where: { id }, include });
    if (!a) throw new NotFoundError('Adjustment not found');
    return a;
  }

  return {
    async list({ status, page, pageSize }) {
      const where = status ? { status } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.ledgerAdjustment.count({ where }),
        prisma.ledgerAdjustment.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { data: rows.map(serialize), meta: { page, pageSize, total } };
    },

    async request(auth, { customerEmail, currency, direction, amount, reason }, ctx) {
      const customer = await prisma.user.findUnique({ where: { email: customerEmail.trim().toLowerCase() } });
      if (!customer || customer.type === 'STAFF')
        throw new ValidationError([
          { location: 'body', path: 'customerEmail', message: 'No investor account with this email', code: 'not_found' },
        ]);
      if (customer.id === auth.user.id) throw new ForbiddenError('You cannot adjust your own wallet');
      const cur = await prisma.currency.findUnique({ where: { code: currency } });
      if (!cur?.isActive)
        throw new ValidationError([{ location: 'body', path: 'currency', message: 'Currency is not enabled', code: 'invalid' }]);
      let amountMinor;
      try {
        amountMinor = fromDecimalString(amount, currency, { [currency]: cur.minorUnits }).minor;
      } catch (err) {
        throw new ValidationError([{ location: 'body', path: 'amount', message: err.message, code: 'invalid' }]);
      }
      if (amountMinor <= 0n)
        throw new ValidationError([{ location: 'body', path: 'amount', message: 'Enter an amount greater than zero', code: 'invalid' }]);

      const created = await prisma.$transaction(async (tx) => {
        const a = await tx.ledgerAdjustment.create({
          data: { customerId: customer.id, currency, direction, amountMinor, reason, requestedById: auth.user.id },
          include,
        });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'ledger.adjustment_requested',
            entityType: 'ledger_adjustment',
            entityId: a.id,
            after: { customerId: customer.id, currency, direction, amountMinor, reason },
            ...ctx,
          },
          tx,
        );
        return a;
      });
      return serialize(created);
    },

    async approve(auth, id, { note }, ctx) {
      const result = await runLedgerTx(prisma, async (tx) => {
        // Lock the request so two approvers cannot both post it.
        await tx.$queryRaw`SELECT id FROM ledger_adjustments WHERE id = ${id}::uuid FOR UPDATE`;
        const a = await load(tx, id);
        if (a.status !== 'PENDING') throw new ConflictError(`This adjustment is already ${a.status.toLowerCase()}`, 'NOT_PENDING');
        if (a.requestedById === auth.user.id) throw new ForbiddenError('Maker-checker: a different person must approve this adjustment');
        if (a.customerId === auth.user.id) throw new ForbiddenError('You cannot approve an adjustment to your own wallet');

        const { accounts } = await wallets.ensureWallet(tx, a.customerId, a.currency);
        const suspense = await ledger.systemAccount(tx, 'MANUAL_ADJUSTMENTS', a.currency);
        const amt = a.amountMinor;
        // CREDIT customer: Dr 3900, Cr customer available. DEBIT customer: the reverse (fails if funds are insufficient).
        const lines =
          a.direction === 'CREDIT'
            ? [
                { accountId: suspense.id, amountMinor: amt, memo: `Adjustment ${a.id}` },
                { accountId: accounts.available.id, amountMinor: -amt, memo: 'Manual adjustment credit' },
              ]
            : [
                { accountId: accounts.available.id, amountMinor: amt, memo: 'Manual adjustment debit' },
                { accountId: suspense.id, amountMinor: -amt, memo: `Adjustment ${a.id}` },
              ];
        const { entry } = await ledger.post(tx, {
          idempotencyKey: `adjustment:${a.id}`,
          type: 'ADJUSTMENT',
          description: `Manual ${a.direction.toLowerCase()}: ${a.reason}`.slice(0, 500),
          referenceType: 'ledger_adjustment',
          referenceId: a.id,
          postedById: auth.user.id,
          metadata: { requestedById: a.requestedById, approvedById: auth.user.id },
          lines,
        });
        const updated = await tx.ledgerAdjustment.update({
          where: { id },
          data: {
            status: 'APPROVED',
            decidedById: auth.user.id,
            decidedAt: new Date(),
            decisionNote: note ?? null,
            journalEntryId: entry.id,
          },
          include,
        });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'ledger.adjustment_approved',
            entityType: 'ledger_adjustment',
            entityId: id,
            metadata: { journalEntryId: entry.id, note },
            ...ctx,
          },
          tx,
        );
        return updated;
      });
      return serialize(result);
    },

    async reject(auth, id, { note }, ctx) {
      const updated = await prisma.$transaction(async (tx) => {
        const a = await load(tx, id);
        if (a.status !== 'PENDING') throw new ConflictError(`This adjustment is already ${a.status.toLowerCase()}`, 'NOT_PENDING');
        if (a.requestedById === auth.user.id) throw new ForbiddenError('Use cancel to withdraw your own request');
        const row = await tx.ledgerAdjustment.update({
          where: { id },
          data: { status: 'REJECTED', decidedById: auth.user.id, decidedAt: new Date(), decisionNote: note },
          include,
        });
        await audit.record(
          {
            actorId: auth.user.id,
            action: 'ledger.adjustment_rejected',
            entityType: 'ledger_adjustment',
            entityId: id,
            metadata: { note },
            ...ctx,
          },
          tx,
        );
        return row;
      });
      return serialize(updated);
    },

    async cancel(auth, id, ctx) {
      const updated = await prisma.$transaction(async (tx) => {
        const a = await load(tx, id);
        if (a.status !== 'PENDING') throw new ConflictError(`This adjustment is already ${a.status.toLowerCase()}`, 'NOT_PENDING');
        if (a.requestedById !== auth.user.id) throw new ForbiddenError('Only the requester can cancel this adjustment');
        const row = await tx.ledgerAdjustment.update({ where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() }, include });
        await audit.record(
          { actorId: auth.user.id, action: 'ledger.adjustment_cancelled', entityType: 'ledger_adjustment', entityId: id, ...ctx },
          tx,
        );
        return row;
      });
      return serialize(updated);
    },
  };
}
