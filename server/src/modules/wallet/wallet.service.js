import { ConflictError, NotFoundError } from '../../utils/errors.js';
import { naturalBalance } from '../ledger/ledger.service.js';

/**
 * Wallets are a view over ledger accounts: a customer's AVAILABLE and RESERVED
 * accounts per currency. There is no writable balance anywhere. Every change is a
 * journal entry, so the wallet always reconciles with the ledger.
 */
export function createWalletService({ prisma, ledger, audit }) {
  async function ensureWallet(tx, userId, currency) {
    const wallet = await tx.wallet.upsert({ where: { userId_currency: { userId, currency } }, update: {}, create: { userId, currency } });
    const accounts = await ledger.customerAccounts(tx, userId, currency);
    return { wallet, accounts };
  }

  async function summary(userId) {
    const [wallets, accounts] = await Promise.all([
      prisma.wallet.findMany({ where: { userId }, orderBy: { currency: 'asc' } }),
      prisma.ledgerAccount.findMany({
        where: { ownerUserId: userId },
        include: { balance: true, currencyRef: { select: { minorUnits: true } } },
      }),
    ]);
    const currencies = new Set([...wallets.map((w) => w.currency), ...accounts.map((a) => a.currency)]);
    if (currencies.size === 0) {
      // No wallet yet: report the platform base currency at zero without creating rows on a read.
      const base = await prisma.currency.findFirst({ where: { isActive: true }, orderBy: { code: 'asc' } });
      if (base) currencies.add(base.code);
    }
    return [...currencies].sort().map((currency) => {
      const w = wallets.find((x) => x.currency === currency);
      const bal = (purpose) => {
        const a = accounts.find((x) => x.currency === currency && x.purpose === purpose);
        return a ? naturalBalance(a.normalBalance, a.balance?.balanceMinor ?? 0n) : 0n;
      };
      const available = bal('CUSTOMER_AVAILABLE');
      const reserved = bal('CUSTOMER_RESERVED');
      return {
        currency,
        status: w?.status ?? 'ACTIVE',
        statusReason: w?.statusReason ?? null,
        available: { amountMinor: available.toString(), currency },
        reserved: { amountMinor: reserved.toString(), currency },
        total: { amountMinor: (available + reserved).toString(), currency },
      };
    });
  }

  /**
   * Ledger lines on the user's wallet accounts, from the customer's point of view:
   * a credit to their (liability) account is money in (+), a debit is money out (−).
   */
  async function activity(userId, { currency, page = 1, pageSize = 20 } = {}) {
    const where = { account: { ownerUserId: userId, ...(currency ? { currency } : {}) } };
    const [total, lines] = await prisma.$transaction([
      prisma.journalLine.count({ where }),
      prisma.journalLine.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { entry: true, account: { select: { purpose: true } } },
      }),
    ]);
    return {
      data: lines.map((l) => ({
        id: l.id.toString(),
        entryNumber: l.entry.entryNumber.toString(),
        type: l.entry.type,
        description: l.entry.description,
        bucket: l.account.purpose === 'CUSTOMER_AVAILABLE' ? 'available' : 'reserved',
        amount: { amountMinor: (-l.amountMinor).toString(), currency: l.currency },
        postedAt: l.entry.postedAt,
      })),
      meta: { page, pageSize, total },
    };
  }

  async function assertActive(tx, userId, currency) {
    const w = await tx.wallet.findUnique({ where: { userId_currency: { userId, currency } } });
    if (w?.status === 'FROZEN') throw new ConflictError('This wallet is frozen. Contact support.', 'WALLET_FROZEN');
  }

  return {
    ensureWallet,
    summary,
    activity,

    /** Moves money from available to reserved (e.g. while an order is processed). Fails with INSUFFICIENT_FUNDS. */
    async reserve(tx, { userId, currency, amountMinor, idempotencyKey, description, referenceType, referenceId, postedById = null }) {
      await assertActive(tx, userId, currency);
      const { accounts } = await ensureWallet(tx, userId, currency);
      return ledger.post(tx, {
        idempotencyKey,
        type: 'RESERVATION',
        description,
        referenceType,
        referenceId,
        postedById,
        lines: [
          { accountId: accounts.available.id, amountMinor: BigInt(amountMinor), memo: 'Reserved from available' },
          { accountId: accounts.reserved.id, amountMinor: -BigInt(amountMinor), memo: 'Reserved' },
        ],
      });
    },

    /** Returns reserved money to available (e.g. a cancelled order). */
    async release(tx, { userId, currency, amountMinor, idempotencyKey, description, referenceType, referenceId, postedById = null }) {
      const { accounts } = await ensureWallet(tx, userId, currency);
      return ledger.post(tx, {
        idempotencyKey,
        type: 'RELEASE',
        description,
        referenceType,
        referenceId,
        postedById,
        lines: [
          { accountId: accounts.reserved.id, amountMinor: BigInt(amountMinor), memo: 'Released from reserved' },
          { accountId: accounts.available.id, amountMinor: -BigInt(amountMinor), memo: 'Returned to available' },
        ],
      });
    },

    async setStatus(auth, userId, currency, { frozen, reason }, ctx) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundError('User not found');
      return prisma.$transaction(async (tx) => {
        const { wallet } = await ensureWallet(tx, userId, currency);
        const status = frozen ? 'FROZEN' : 'ACTIVE';
        if (wallet.status === status) throw new ConflictError(`Wallet is already ${status.toLowerCase()}`, 'NO_CHANGE');
        await tx.wallet.update({ where: { id: wallet.id }, data: { status, statusReason: frozen ? reason : null } });
        await audit.record(
          {
            actorId: auth.user.id,
            action: frozen ? 'wallet.frozen' : 'wallet.unfrozen',
            entityType: 'wallet',
            entityId: wallet.id,
            before: { status: wallet.status },
            after: { status },
            metadata: { userId, currency, reason },
            ...ctx,
          },
          tx,
        );
        return { status };
      });
    },
  };
}
