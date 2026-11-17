export const LEDGER_RECONCILIATION_JOB = 'ledger-integrity';
export const IDEMPOTENCY_CLEANUP_JOB = 'idempotency-cleanup';
export const PENDING_PAYMENTS_JOB = 'pending-payments';
export const MATURITY_FLAG_JOB = 'maturity-flag';

/**
 * Daily ledger integrity check, hourly idempotency cleanup, payment reconciliation every
 * 5 minutes (settles payments whose webhook never arrived), and daily maturity flagging.
 */
export function reconciliationProcessors({ reconciliation, prisma, deposits, orders }) {
  return {
    [LEDGER_RECONCILIATION_JOB]: async () => {
      const run = await reconciliation.runLedgerIntegrity();
      return { runId: run.id, status: run.status };
    },
    [PENDING_PAYMENTS_JOB]: async () => deposits.reconcilePending(),
    [MATURITY_FLAG_JOB]: async () => orders.flagMaturities(),
    [IDEMPOTENCY_CLEANUP_JOB]: async () => {
      const { count } = await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      return { removed: count };
    },
  };
}
