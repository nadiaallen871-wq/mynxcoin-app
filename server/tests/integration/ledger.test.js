import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/db/prisma.js';
import { seed } from '../../src/db/seed.js';
import { createLedgerService, runLedgerTx } from '../../src/modules/ledger/ledger.service.js';
import { createWalletService } from '../../src/modules/wallet/wallet.service.js';
import { createReconciliationService } from '../../src/modules/ledger/reconciliation.service.js';
import { createAuditService } from '../../src/modules/audit/audit.service.js';
import { testLogger } from '../helpers.js';

const ledger = createLedgerService({ prisma });
const wallets = createWalletService({ prisma, ledger, audit: createAuditService({ prisma }) });
const reconciliation = createReconciliationService({ prisma, logger: testLogger });
const key = (tag = 'test') => `${tag}:${randomUUID()}`;

let suspense;
async function newCustomer() {
  return prisma.user.create({
    data: { email: `ledger-${randomUUID().slice(0, 8)}@example.test`, type: 'INDIVIDUAL', status: 'PENDING_VERIFICATION' },
  });
}
/** Credits a customer's available balance from the adjustments account. */
async function fund(userId, amount) {
  return runLedgerTx(prisma, async (tx) => {
    const { accounts } = await wallets.ensureWallet(tx, userId, 'GHS');
    return ledger.post(tx, {
      idempotencyKey: key('fund'),
      type: 'ADJUSTMENT',
      description: 'Test funding',
      lines: [
        { accountId: suspense.id, amountMinor: BigInt(amount) },
        { accountId: accounts.available.id, amountMinor: -BigInt(amount) },
      ],
    });
  });
}
const walletOf = async (userId) => (await wallets.summary(userId)).find((w) => w.currency === 'GHS');

beforeAll(async () => {
  await seed(prisma);
  suspense = await prisma.ledgerAccount.findFirst({ where: { purpose: 'MANUAL_ADJUSTMENTS', currency: 'GHS', ownerUserId: null } });
});
afterAll(() => prisma.$disconnect());

describe('database-level guarantees', () => {
  it('rejects an unbalanced entry at commit, writing nothing', async () => {
    const before = await prisma.journalEntry.count();
    const clearing = await prisma.ledgerAccount.findFirst({ where: { purpose: 'PAYMENT_CLEARING', currency: 'GHS', ownerUserId: null } });
    await expect(
      prisma.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({ data: { idempotencyKey: key(), type: 'TEST', description: 'unbalanced' } });
        await tx.journalLine.createMany({
          data: [
            { entryId: e.id, accountId: suspense.id, amountMinor: 100n, currency: 'GHS' },
            { entryId: e.id, accountId: clearing.id, amountMinor: -99n, currency: 'GHS' },
          ],
        });
      }),
    ).rejects.toThrow(/MYNX_UNBALANCED_ENTRY/);
    expect(await prisma.journalEntry.count()).toBe(before);
  });

  it('rejects entries with fewer than two lines and zero-amount lines', async () => {
    await expect(
      prisma.$transaction((tx) => tx.journalEntry.create({ data: { idempotencyKey: key(), type: 'TEST', description: 'empty' } })),
    ).rejects.toThrow(/at least two lines/);
    await expect(
      prisma.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({ data: { idempotencyKey: key(), type: 'TEST', description: 'zero' } });
        await tx.journalLine.create({ data: { entryId: e.id, accountId: suspense.id, amountMinor: 0n, currency: 'GHS' } });
      }),
    ).rejects.toThrow();
  });

  it('rejects a line whose currency differs from its account', async () => {
    const usd = await prisma.ledgerAccount.findFirst({ where: { purpose: 'MANUAL_ADJUSTMENTS', currency: 'USD', ownerUserId: null } });
    await expect(
      prisma.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({ data: { idempotencyKey: key(), type: 'TEST', description: 'fx' } });
        await tx.journalLine.createMany({
          data: [
            { entryId: e.id, accountId: suspense.id, amountMinor: 100n, currency: 'GHS' },
            { entryId: e.id, accountId: usd.id, amountMinor: -100n, currency: 'GHS' },
          ],
        });
      }),
    ).rejects.toThrow(/MYNX_CURRENCY_MISMATCH/);
  });

  it('makes posted entries, lines and balances immutable', async () => {
    const user = await newCustomer();
    const { entry } = await fund(user.id, 5_000);
    const line = entry.lines[0];
    await expect(prisma.journalLine.update({ where: { id: line.id }, data: { amountMinor: 1n } })).rejects.toThrow(/append-only/);
    await expect(prisma.journalLine.delete({ where: { id: line.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.journalEntry.update({ where: { id: entry.id }, data: { description: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE journal_lines CASCADE')).rejects.toThrow();
    await expect(
      prisma.ledgerAccountBalance.update({ where: { accountId: line.accountId }, data: { balanceMinor: 999_999n } }),
    ).rejects.toThrow(/MYNX_BALANCE_READ_ONLY/);
    await expect(prisma.ledgerAccountBalance.delete({ where: { accountId: line.accountId } })).rejects.toThrow(/MYNX_BALANCE_READ_ONLY/);
  });

  it('keeps account identity immutable and accounts undeletable', async () => {
    await expect(prisma.ledgerAccount.update({ where: { id: suspense.id }, data: { currency: 'USD' } })).rejects.toThrow(/immutable/);
    await expect(prisma.ledgerAccount.update({ where: { id: suspense.id }, data: { allowNegative: false } })).rejects.toThrow(/immutable/);
    await expect(prisma.ledgerAccount.delete({ where: { id: suspense.id } })).rejects.toThrow();
    await prisma.ledgerAccount.update({ where: { id: suspense.id }, data: { name: suspense.name } }); // renaming is allowed
  });

  it('never lets a customer account go negative, even when writing directly', async () => {
    const user = await newCustomer();
    await fund(user.id, 1_000);
    const { accounts } = await runLedgerTx(prisma, (tx) => wallets.ensureWallet(tx, user.id, 'GHS'));
    await expect(
      prisma.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({ data: { idempotencyKey: key(), type: 'TEST', description: 'overdraw' } });
        await tx.journalLine.createMany({
          data: [
            { entryId: e.id, accountId: accounts.available.id, amountMinor: 1_001n, currency: 'GHS' },
            { entryId: e.id, accountId: suspense.id, amountMinor: -1_001n, currency: 'GHS' },
          ],
        });
      }),
    ).rejects.toThrow(/MYNX_INSUFFICIENT_FUNDS/);
    expect((await walletOf(user.id)).available.amountMinor).toBe('1000');
  });
});

describe('ledger service', () => {
  it('posts balanced entries and keeps every currency trial balance at zero', async () => {
    const user = await newCustomer();
    await fund(user.id, 250_000);
    expect((await walletOf(user.id)).available.amountMinor).toBe('250000');
    const tb = await ledger.trialBalance('GHS');
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitsMinor).toBe(tb.totalCreditsMinor);
  });

  it('is idempotent: same key and lines replay, same key with different lines is refused', async () => {
    const user = await newCustomer();
    const { accounts } = await runLedgerTx(prisma, (tx) => wallets.ensureWallet(tx, user.id, 'GHS'));
    const k = key('idem');
    const lines = [
      { accountId: suspense.id, amountMinor: 700n },
      { accountId: accounts.available.id, amountMinor: -700n },
    ];
    const first = await runLedgerTx(prisma, (tx) => ledger.post(tx, { idempotencyKey: k, type: 'TEST', description: 'once', lines }));
    const again = await runLedgerTx(prisma, (tx) =>
      ledger.post(tx, { idempotencyKey: k, type: 'TEST', description: 'once', lines: [...lines].reverse() }),
    );
    expect(again.replayed).toBe(true);
    expect(again.entry.id).toBe(first.entry.id);
    expect((await walletOf(user.id)).available.amountMinor).toBe('700');
    await expect(
      runLedgerTx(prisma, (tx) =>
        ledger.post(tx, {
          idempotencyKey: k,
          type: 'TEST',
          description: 'different',
          lines: [
            { accountId: suspense.id, amountMinor: 800n },
            { accountId: accounts.available.id, amountMinor: -800n },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('refuses unbalanced input before touching the database', async () => {
    await expect(
      runLedgerTx(prisma, (tx) =>
        ledger.post(tx, {
          idempotencyKey: key(),
          type: 'TEST',
          description: 'bad',
          lines: [
            { accountId: suspense.id, amountMinor: 1n },
            { accountId: suspense.id, amountMinor: 1n },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'LEDGER_UNBALANCED' });
  });

  it('reverses an entry exactly, once, and never a reversal', async () => {
    const user = await newCustomer();
    const { entry } = await fund(user.id, 3_000);
    const { entry: rev } = await runLedgerTx(prisma, (tx) =>
      ledger.reverse(tx, entry.id, { idempotencyKey: key('rev'), reason: 'Posted in error' }),
    );
    expect(rev.reversesEntryId).toBe(entry.id);
    expect((await walletOf(user.id)).available.amountMinor).toBe('0');
    await expect(
      runLedgerTx(prisma, (tx) => ledger.reverse(tx, entry.id, { idempotencyKey: key('rev2'), reason: 'again' })),
    ).rejects.toMatchObject({ code: 'ALREADY_REVERSED' });
    await expect(
      runLedgerTx(prisma, (tx) => ledger.reverse(tx, rev.id, { idempotencyKey: key('rev3'), reason: 'undo' })),
    ).rejects.toMatchObject({ code: 'CANNOT_REVERSE_REVERSAL' });
  });

  it('rejects an inexact reversal at the database level', async () => {
    const user = await newCustomer();
    const { entry } = await fund(user.id, 2_000);
    const clearing = await prisma.ledgerAccount.findFirst({ where: { purpose: 'PAYMENT_CLEARING', currency: 'GHS', ownerUserId: null } });
    await expect(
      prisma.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({
          data: { idempotencyKey: key(), type: 'REVERSAL', description: 'wrong', reversesEntryId: entry.id },
        });
        await tx.journalLine.createMany({
          data: [
            { entryId: e.id, accountId: clearing.id, amountMinor: -2_000n, currency: 'GHS' },
            { entryId: e.id, accountId: entry.lines.find((l) => l.amountMinor < 0n).accountId, amountMinor: 2_000n, currency: 'GHS' },
          ],
        });
      }),
    ).rejects.toThrow(/MYNX_BAD_REVERSAL/);
  });
});

describe('wallet reservations and concurrency', () => {
  it('reserves and releases between available and reserved', async () => {
    const user = await newCustomer();
    await fund(user.id, 10_000);
    await runLedgerTx(prisma, (tx) =>
      wallets.reserve(tx, { userId: user.id, currency: 'GHS', amountMinor: 4_000n, idempotencyKey: key('res'), description: 'Order hold' }),
    );
    let w = await walletOf(user.id);
    expect([w.available.amountMinor, w.reserved.amountMinor, w.total.amountMinor]).toEqual(['6000', '4000', '10000']);
    await runLedgerTx(prisma, (tx) =>
      wallets.release(tx, {
        userId: user.id,
        currency: 'GHS',
        amountMinor: 1_500n,
        idempotencyKey: key('rel'),
        description: 'Partial release',
      }),
    );
    w = await walletOf(user.id);
    expect([w.available.amountMinor, w.reserved.amountMinor]).toEqual(['7500', '2500']);
    await expect(
      runLedgerTx(prisma, (tx) =>
        wallets.release(tx, { userId: user.id, currency: 'GHS', amountMinor: 2_501n, idempotencyKey: key('rel'), description: 'Too much' }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });

  it('prevents double spending: 10 concurrent reservations against 1,000 allow exactly 6 of 150', async () => {
    const user = await newCustomer();
    await fund(user.id, 1_000);
    await runLedgerTx(prisma, (tx) => wallets.ensureWallet(tx, user.id, 'GHS'));
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        runLedgerTx(prisma, (tx) =>
          wallets.reserve(tx, {
            userId: user.id,
            currency: 'GHS',
            amountMinor: 150n,
            idempotencyKey: key(`race${i}`),
            description: `Race ${i}`,
          }),
        ),
      ),
    );
    const ok = attempts.filter((a) => a.status === 'fulfilled').length;
    const insufficient = attempts.filter((a) => a.status === 'rejected' && a.reason.code === 'INSUFFICIENT_FUNDS').length;
    expect(ok).toBe(6);
    expect(insufficient).toBe(4);
    const w = await walletOf(user.id);
    expect([w.available.amountMinor, w.reserved.amountMinor]).toEqual(['100', '900']);
  });

  it('posts once when the same idempotency key is submitted concurrently', async () => {
    const user = await newCustomer();
    await fund(user.id, 5_000);
    const k = key('dup');
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        runLedgerTx(prisma, (tx) =>
          wallets.reserve(tx, {
            userId: user.id,
            currency: 'GHS',
            amountMinor: 1_000n,
            idempotencyKey: k,
            description: 'Duplicate submit',
          }),
        ),
      ),
    );
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: k } })).toBe(1);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect((await walletOf(user.id)).reserved.amountMinor).toBe('1000');
  });

  it('refuses reservations from a frozen wallet', async () => {
    const user = await newCustomer();
    await fund(user.id, 5_000);
    await prisma.wallet.update({
      where: { userId_currency: { userId: user.id, currency: 'GHS' } },
      data: { status: 'FROZEN', statusReason: 'Compliance review' },
    });
    await expect(
      runLedgerTx(prisma, (tx) =>
        wallets.reserve(tx, { userId: user.id, currency: 'GHS', amountMinor: 100n, idempotencyKey: key(), description: 'x' }),
      ),
    ).rejects.toMatchObject({ code: 'WALLET_FROZEN' });
  });
});

describe('reconciliation', () => {
  it('passes on a healthy ledger', async () => {
    const run = await reconciliation.runLedgerIntegrity();
    expect(run.status).toBe('PASSED');
    expect(run.discrepancies).toEqual([]);
    expect(run.summary.trialBalance.find((t) => t.currency === 'GHS').netMinor).toBe('0');
  });

  it('detects a tampered balance cache (simulated with triggers disabled) and the run record is immutable', async () => {
    const user = await newCustomer();
    await fund(user.id, 1_234);
    const acct = await prisma.ledgerAccount.findFirst({ where: { ownerUserId: user.id, purpose: 'CUSTOMER_AVAILABLE' } });
    const tamper = (delta) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE ledger_account_balances DISABLE TRIGGER ledger_account_balances_guard');
        await tx.$executeRawUnsafe(
          `UPDATE ledger_account_balances SET balance_minor = balance_minor + (${delta}) WHERE account_id = '${acct.id}'`,
        );
        await tx.$executeRawUnsafe('ALTER TABLE ledger_account_balances ENABLE TRIGGER ledger_account_balances_guard');
      });
    await tamper(-500);
    try {
      const run = await reconciliation.runLedgerIntegrity();
      expect(run.status).toBe('FAILED');
      expect(run.discrepancies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ check: 'balance_matches_lines', accountId: acct.id, cachedMinor: '-1734', actualMinor: '-1234' }),
        ]),
      );
      await expect(prisma.reconciliationRun.update({ where: { id: run.id }, data: { status: 'PASSED' } })).rejects.toThrow(/append-only/);
    } finally {
      await tamper(500);
    }
    expect((await reconciliation.runLedgerIntegrity()).status).toBe('PASSED');
  });
});
