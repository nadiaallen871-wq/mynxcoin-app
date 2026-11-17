import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError, ConflictError, NotFoundError } from '../../utils/errors.js';

/**
 * Double-entry ledger.
 *
 * Every posting is one journal entry with ≥ 2 lines whose signed amounts
 * (debit +, credit −) sum to zero per currency. The database enforces this too:
 * balanced entries (deferred constraint trigger), immutability, currency match,
 * no-negative customer accounts and trigger-maintained balances. This service adds
 * friendly validation, idempotency, and deterministic row locking.
 *
 * Callers pass a transaction client so the business change and its posting commit
 * together. Use `runLedgerTx` to get ledger errors (including those raised at
 * commit) mapped to API errors.
 */
export class InsufficientFundsError extends AppError {
  constructor(message = 'Insufficient available balance') {
    super(message, { status: 409, code: 'INSUFFICIENT_FUNDS' });
  }
}

export function mapLedgerError(err) {
  const text = String(err?.message ?? '');
  if (text.includes('MYNX_INSUFFICIENT_FUNDS')) return new InsufficientFundsError();
  if (text.includes('MYNX_UNBALANCED_ENTRY') || text.includes('MYNX_BAD_REVERSAL') || text.includes('MYNX_CURRENCY_MISMATCH')) {
    // These indicate a programming error: the posting was rejected and nothing was written.
    return new AppError('The ledger rejected an invalid posting', { status: 500, code: 'LEDGER_INTEGRITY', cause: err });
  }
  if (text.includes('MYNX_ACCOUNT_INACTIVE')) return new ConflictError('The account is inactive', 'ACCOUNT_INACTIVE');
  return err;
}

/** Runs `fn(tx)` in a transaction and maps ledger trigger errors, including deferred ones raised at COMMIT. */
export async function runLedgerTx(prisma, fn, options = {}) {
  try {
    return await prisma.$transaction(fn, { timeout: 15_000, ...options });
  } catch (err) {
    throw mapLedgerError(err);
  }
}

const canonicalLines = (lines) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        lines.map((l) => [l.accountId, BigInt(l.amountMinor).toString(), l.currency]).sort((a, b) => (a.join('|') < b.join('|') ? -1 : 1)),
      ),
    )
    .digest('hex');

/** Natural balance: positive in the account's normal direction (e.g. a customer's available money). */
export const naturalBalance = (normalBalance, debitPositive) => (normalBalance === 'CREDIT' ? -debitPositive : debitPositive);

export function createLedgerService({ prisma }) {
  async function systemAccount(tx, purpose, currency) {
    const account = await tx.ledgerAccount.findFirst({ where: { purpose, currency, ownerUserId: null } });
    if (!account)
      throw new AppError(`System account ${purpose}/${currency} is missing. Run the seed.`, { status: 500, code: 'LEDGER_SETUP' });
    return account;
  }

  /** Gets or creates a customer's AVAILABLE and RESERVED accounts for a currency. Safe under concurrency. */
  async function customerAccounts(tx, userId, currency) {
    const specs = [
      { purpose: 'CUSTOMER_AVAILABLE', code: '2000', name: 'Customer wallet: available' },
      { purpose: 'CUSTOMER_RESERVED', code: '2010', name: 'Customer wallet: reserved' },
    ];
    const result = {};
    for (const s of specs) {
      let account = await tx.ledgerAccount.findFirst({ where: { purpose: s.purpose, currency, ownerUserId: userId } });
      if (!account) {
        // ON CONFLICT DO NOTHING keeps a concurrent creator from aborting this transaction.
        await tx.$executeRaw`
          INSERT INTO ledger_accounts (id, code, name, type, normal_balance, purpose, currency, owner_user_id, allow_negative, is_active, created_at)
          VALUES (gen_random_uuid(), ${s.code}, ${s.name}, 'LIABILITY', 'CREDIT', ${s.purpose}::"AccountPurpose", ${currency}, ${userId}::uuid, false, true, now())
          ON CONFLICT DO NOTHING`;
        account = await tx.ledgerAccount.findFirst({ where: { purpose: s.purpose, currency, ownerUserId: userId } });
      }
      result[s.purpose === 'CUSTOMER_AVAILABLE' ? 'available' : 'reserved'] = account;
    }
    return result;
  }

  /**
   * Posts a balanced entry. Idempotent: posting the same key with identical lines
   * returns the original entry (`replayed: true`). The same key with different lines is rejected.
   */
  async function post(
    tx,
    {
      idempotencyKey,
      type,
      description,
      referenceType = null,
      referenceId = null,
      postedById = null,
      metadata = null,
      reversesEntryId = null,
      lines,
    },
  ) {
    if (!idempotencyKey) throw new AppError('A ledger posting needs an idempotency key', { status: 500, code: 'LEDGER_USAGE' });
    if (!Array.isArray(lines) || lines.length < 2)
      throw new AppError('A journal entry needs at least two lines', { status: 500, code: 'LEDGER_USAGE' });

    const accounts = await tx.ledgerAccount.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.accountId))] } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const normalized = lines.map((l) => {
      const account = byId.get(l.accountId);
      if (!account) throw new AppError(`Unknown ledger account ${l.accountId}`, { status: 500, code: 'LEDGER_USAGE' });
      const amount = BigInt(l.amountMinor);
      if (amount === 0n) throw new AppError('Journal lines cannot be zero', { status: 500, code: 'LEDGER_USAGE' });
      return { accountId: l.accountId, amountMinor: amount, currency: account.currency, memo: l.memo ?? null };
    });
    const sums = new Map();
    for (const l of normalized) sums.set(l.currency, (sums.get(l.currency) ?? 0n) + l.amountMinor);
    for (const [currency, total] of sums) {
      if (total !== 0n)
        throw new AppError(`Journal entry does not balance in ${currency} (off by ${total})`, { status: 500, code: 'LEDGER_UNBALANCED' });
    }

    const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey }, include: { lines: true } });
    if (existing) {
      if (canonicalLines(existing.lines) !== canonicalLines(normalized)) {
        throw new ConflictError('This idempotency key was already used for a different posting', 'IDEMPOTENCY_KEY_REUSED');
      }
      return { entry: existing, replayed: true };
    }

    // Lock the affected balance rows in a fixed order, so concurrent postings never deadlock.
    const ids = [...byId.keys()].sort();
    await tx.$queryRaw`SELECT account_id FROM ledger_account_balances WHERE account_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY account_id FOR UPDATE`;

    try {
      const entry = await tx.journalEntry.create({
        data: { idempotencyKey, type, description, referenceType, referenceId, postedById, metadata, reversesEntryId },
      });
      await tx.journalLine.createMany({ data: normalized.map((l) => ({ ...l, entryId: entry.id })) });
      return { entry: await tx.journalEntry.findUnique({ where: { id: entry.id }, include: { lines: true } }), replayed: false };
    } catch (err) {
      throw mapLedgerError(err);
    }
  }

  /** Posts the exact negation of an entry. An entry can be reversed only once. */
  async function reverse(tx, entryId, { idempotencyKey, reason, postedById = null }) {
    const original = await tx.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true, reversedBy: true } });
    if (!original) throw new NotFoundError('Journal entry not found');
    if (original.reversesEntryId)
      throw new ConflictError('A reversal cannot itself be reversed. Post a new entry instead.', 'CANNOT_REVERSE_REVERSAL');
    if (original.reversedBy && original.reversedBy.idempotencyKey !== idempotencyKey)
      throw new ConflictError('This entry has already been reversed', 'ALREADY_REVERSED');
    return post(tx, {
      idempotencyKey,
      type: 'REVERSAL',
      description: `Reversal of #${original.entryNumber}: ${reason}`,
      referenceType: 'journal_entry',
      referenceId: original.id,
      reversesEntryId: original.id,
      postedById,
      lines: original.lines.map((l) => ({ accountId: l.accountId, amountMinor: -l.amountMinor, memo: `Reversal: ${l.memo ?? ''}`.trim() })),
    });
  }

  async function balances(accountIds, tx = prisma) {
    const rows = await tx.ledgerAccountBalance.findMany({ where: { accountId: { in: accountIds } } });
    return new Map(rows.map((r) => [r.accountId, r.balanceMinor]));
  }

  const serializeLine = (l) => ({
    id: l.id.toString(),
    accountId: l.accountId,
    account: l.account && { code: l.account.code, name: l.account.name, purpose: l.account.purpose, ownerUserId: l.account.ownerUserId },
    debitMinor: l.amountMinor > 0n ? l.amountMinor.toString() : '0',
    creditMinor: l.amountMinor < 0n ? (-l.amountMinor).toString() : '0',
    amountMinor: l.amountMinor.toString(),
    currency: l.currency,
    memo: l.memo,
  });

  const serializeEntry = (e) => ({
    id: e.id,
    entryNumber: e.entryNumber.toString(),
    type: e.type,
    description: e.description,
    referenceType: e.referenceType,
    referenceId: e.referenceId,
    reversesEntryId: e.reversesEntryId,
    reversedByEntryId: e.reversedBy?.id ?? null,
    postedBy: e.postedBy
      ? e.postedBy.profile
        ? `${e.postedBy.profile.firstName} ${e.postedBy.profile.lastName}`
        : e.postedBy.email
      : null,
    postedAt: e.postedAt,
    lines: e.lines?.map(serializeLine),
  });

  return {
    systemAccount,
    customerAccounts,
    post,
    reverse,
    balances,
    serializeEntry,

    async listAccounts({ currency, scope = 'system' }) {
      const accounts = await prisma.ledgerAccount.findMany({
        where: { currency, ...(scope === 'system' ? { ownerUserId: null } : {}) },
        include: { balance: true },
        orderBy: [{ code: 'asc' }],
      });
      return accounts.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        purpose: a.purpose,
        normalBalance: a.normalBalance,
        currency: a.currency,
        balanceMinor: (a.balance?.balanceMinor ?? 0n).toString(),
        naturalBalanceMinor: naturalBalance(a.normalBalance, a.balance?.balanceMinor ?? 0n).toString(),
      }));
    },

    /**
     * Trial balance for one currency: system accounts listed individually, and customer
     * wallet accounts aggregated into their control accounts (2000, 2010). Debits must equal credits.
     */
    async trialBalance(currency) {
      const rows = await prisma.$queryRaw`
        SELECT a.code, a.purpose::text AS purpose, MIN(a.name) AS name, a.type::text AS type, a.normal_balance::text AS normal,
               (a.owner_user_id IS NOT NULL) AS customer, COUNT(*)::int AS accounts, COALESCE(SUM(b.balance_minor), 0)::bigint AS balance
          FROM ledger_accounts a JOIN ledger_account_balances b ON b.account_id = a.id
         WHERE a.currency = ${currency}
         GROUP BY a.code, a.purpose, a.type, a.normal_balance, (a.owner_user_id IS NOT NULL)
         ORDER BY a.code`;
      let debits = 0n;
      let credits = 0n;
      const lines = rows.map((r) => {
        if (r.balance > 0n) debits += r.balance;
        else credits += -r.balance;
        return {
          code: r.code,
          name: r.customer
            ? `${r.name.replace(/:.*/, '')}: ${r.purpose === 'CUSTOMER_AVAILABLE' ? 'available' : 'reserved'} (${r.accounts} customer accounts)`
            : r.name,
          type: r.type,
          debitMinor: r.balance > 0n ? r.balance.toString() : '0',
          creditMinor: r.balance < 0n ? (-r.balance).toString() : '0',
        };
      });
      return { currency, lines, totalDebitsMinor: debits.toString(), totalCreditsMinor: credits.toString(), balanced: debits === credits };
    },

    async listEntries({ type, page, pageSize }) {
      const where = type ? { type } : {};
      const [total, rows] = await prisma.$transaction([
        prisma.journalEntry.count({ where }),
        prisma.journalEntry.findMany({
          where,
          orderBy: { entryNumber: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            lines: { include: { account: true } },
            reversedBy: { select: { id: true } },
            postedBy: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
          },
        }),
      ]);
      return { data: rows.map(serializeEntry), meta: { page, pageSize, total } };
    },

    async getEntry(id) {
      const e = await prisma.journalEntry.findUnique({
        where: { id },
        include: {
          lines: { include: { account: true } },
          reversedBy: { select: { id: true } },
          postedBy: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
        },
      });
      if (!e) throw new NotFoundError('Journal entry not found');
      return serializeEntry(e);
    },
  };
}
