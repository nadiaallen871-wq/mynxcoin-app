/**
 * Ledger integrity reconciliation. Independent SQL checks that would catch any
 * corruption the triggers should already prevent (e.g. a restore from a bad
 * backup, or manual intervention with triggers disabled):
 *
 *  1. every journal entry balances per currency
 *  2. every journal entry has at least two lines
 *  3. cached account balances equal the sum of their lines
 *  4. no customer wallet account is negative
 *  5. the trial balance of each currency nets to zero
 *
 * Each run is stored immutably. A failure is logged at error level so alerting can pick it up.
 * Payment-provider reconciliation (ledger vs provider statements) is added in Phase 6.
 */
const big = (v) => (typeof v === 'bigint' ? v.toString() : v);

export function createReconciliationService({ prisma, logger }) {
  const serialize = (r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    summary: r.summary,
    discrepancies: r.discrepancies,
    triggeredBy: r.triggeredBy
      ? r.triggeredBy.profile
        ? `${r.triggeredBy.profile.firstName} ${r.triggeredBy.profile.lastName}`
        : r.triggeredBy.email
      : 'Scheduled',
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  });
  const include = { triggeredBy: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } };

  return {
    async runLedgerIntegrity({ triggeredById = null } = {}) {
      const startedAt = new Date();
      const [unbalanced, thin, cacheMismatch, negativeCustomers, trial, counts] = await Promise.all([
        prisma.$queryRaw`SELECT entry_id::text, currency, SUM(amount_minor)::bigint AS total FROM journal_lines GROUP BY entry_id, currency HAVING SUM(amount_minor) <> 0 LIMIT 100`,
        prisma.$queryRaw`SELECT e.id::text AS entry_id, COUNT(l.id)::int AS lines FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id = e.id GROUP BY e.id HAVING COUNT(l.id) < 2 LIMIT 100`,
        prisma.$queryRaw`
          SELECT b.account_id::text, b.balance_minor AS cached, COALESCE(SUM(l.amount_minor), 0)::bigint AS actual
            FROM ledger_account_balances b LEFT JOIN journal_lines l ON l.account_id = b.account_id
           GROUP BY b.account_id, b.balance_minor HAVING b.balance_minor <> COALESCE(SUM(l.amount_minor), 0) LIMIT 100`,
        prisma.$queryRaw`
          SELECT a.id::text AS account_id, a.owner_user_id::text AS user_id, b.balance_minor AS balance
            FROM ledger_accounts a JOIN ledger_account_balances b ON b.account_id = a.id
           WHERE a.allow_negative = false AND ((a.normal_balance = 'CREDIT' AND b.balance_minor > 0) OR (a.normal_balance = 'DEBIT' AND b.balance_minor < 0)) LIMIT 100`,
        prisma.$queryRaw`
          SELECT a.currency, COALESCE(SUM(b.balance_minor), 0)::bigint AS net,
                 COALESCE(SUM(CASE WHEN b.balance_minor > 0 THEN b.balance_minor ELSE 0 END), 0)::bigint AS debits
            FROM ledger_accounts a JOIN ledger_account_balances b ON b.account_id = a.id GROUP BY a.currency ORDER BY a.currency`,
        prisma.$queryRaw`SELECT (SELECT COUNT(*) FROM journal_entries)::int AS entries, (SELECT COUNT(*) FROM journal_lines)::int AS lines, (SELECT COUNT(*) FROM ledger_accounts)::int AS accounts`,
      ]);

      const discrepancies = [
        ...unbalanced.map((r) => ({ check: 'entry_balanced', entryId: r.entry_id, currency: r.currency, offByMinor: big(r.total) })),
        ...thin.map((r) => ({ check: 'entry_has_two_lines', entryId: r.entry_id, lines: r.lines })),
        ...cacheMismatch.map((r) => ({
          check: 'balance_matches_lines',
          accountId: r.account_id,
          cachedMinor: big(r.cached),
          actualMinor: big(r.actual),
        })),
        ...negativeCustomers.map((r) => ({
          check: 'customer_not_negative',
          accountId: r.account_id,
          userId: r.user_id,
          balanceMinor: big(r.balance),
        })),
        ...trial.filter((r) => r.net !== 0n).map((r) => ({ check: 'trial_balance_zero', currency: r.currency, netMinor: big(r.net) })),
      ];
      const status = discrepancies.length ? 'FAILED' : 'PASSED';
      const summary = {
        entriesChecked: counts[0].entries,
        linesChecked: counts[0].lines,
        accountsChecked: counts[0].accounts,
        checks: ['entry_balanced', 'entry_has_two_lines', 'balance_matches_lines', 'customer_not_negative', 'trial_balance_zero'],
        trialBalance: trial.map((r) => ({ currency: r.currency, totalDebitsMinor: big(r.debits), netMinor: big(r.net) })),
      };
      const run = await prisma.reconciliationRun.create({
        data: { type: 'LEDGER_INTEGRITY', status, summary, discrepancies, triggeredById, startedAt, finishedAt: new Date() },
        include,
      });
      if (status === 'FAILED') logger.error({ runId: run.id, discrepancies: discrepancies.length }, 'LEDGER RECONCILIATION FAILED');
      else logger.info({ runId: run.id }, 'ledger reconciliation passed');
      return serialize(run);
    },

    async list({ page, pageSize }) {
      const [total, rows] = await prisma.$transaction([
        prisma.reconciliationRun.count(),
        prisma.reconciliationRun.findMany({ include, orderBy: { startedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return { data: rows.map(serialize), meta: { page, pageSize, total } };
    },
  };
}
