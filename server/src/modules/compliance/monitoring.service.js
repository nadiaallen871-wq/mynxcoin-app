/**
 * Transaction monitoring. Rules run after the business change has committed and only
 * raise alerts for a person to review: they never block, reverse or freeze anything.
 * Each rule raises at most one alert per triggering record (dedupe key).
 *
 * Rules:
 *  - LARGE_DEPOSIT          a deposit at or above `monitoring.large_deposit_minor`
 *  - AMOUNT_MISMATCH        the provider confirmed a different amount or currency
 *  - WITHDRAWAL_RISK_FLAGS  a withdrawal request carrying two or more risk flags
 *  - PASS_THROUGH           a withdrawal of ≥ 80% of the money deposited within
 *                           `monitoring.pass_through_hours`, with no investment in between
 *  - SUSPICIOUS_LOGIN       a sign-in from a new device after 3+ failed attempts in the last hour
 *  - REFERRAL_ABUSE_SIGNAL  a referral held for review because of abuse signals (raised by referrals)
 *
 * Thresholds are system settings. They are starting points, not a compliance
 * programme: tune them with the compliance officer for the actual business.
 */
export function createMonitoringService({ prisma, settings, logger }) {
  async function raise({ userId, rule, severity, summary, details = null, referenceType = null, referenceId = null }) {
    try {
      return await prisma.monitoringAlert.create({
        data: {
          userId,
          rule,
          severity,
          summary,
          details,
          referenceType,
          referenceId,
          dedupeKey: `${rule}:${referenceType}:${referenceId}`,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') return null; // already raised for this record
      logger?.error({ err, rule, referenceId }, 'monitoring rule could not raise its alert');
      return null;
    }
  }

  const safely = (name, fn) => async (id) => {
    try {
      return await fn(id);
    } catch (err) {
      logger?.error({ err, rule: name, id }, 'monitoring rule failed');
      return null;
    }
  };

  return {
    raise,

    /** After a successful password sign-in. Never throws. */
    onLogin: safely('login', async ({ userId, knownDevice }) => {
      if (knownDevice) return null;
      const since = new Date(Date.now() - 3_600_000);
      const failures = await prisma.loginAttempt.findMany({
        where: { userId, success: false, createdAt: { gte: since } },
        select: { ipAddress: true },
      });
      if (failures.length < 3) return null;
      const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
      return raise({
        userId,
        rule: 'SUSPICIOUS_LOGIN',
        severity: 'HIGH',
        summary: `Sign-in from a new device after ${failures.length} failed attempts in the last hour`,
        referenceType: 'user_hour',
        referenceId: `${userId.slice(0, 8)}:${hour}`,
        details: { failedAttempts: failures.length, distinctIps: new Set(failures.map((f) => f.ipAddress)).size },
      });
    }),

    onDepositCredited: safely('deposit', async (depositId) => {
      const d = await prisma.deposit.findUnique({ where: { id: depositId } });
      if (!d) return null;
      const threshold = BigInt(await settings.get('monitoring.large_deposit_minor'));
      if (d.amountMinor < threshold) return null;
      return raise({
        userId: d.userId,
        rule: 'LARGE_DEPOSIT',
        severity: 'MEDIUM',
        summary: 'Deposit at or above the large-deposit threshold',
        referenceType: 'deposit',
        referenceId: d.id,
        details: { amountMinor: d.amountMinor.toString(), thresholdMinor: threshold.toString(), currency: d.currency },
      });
    }),

    onWithdrawalRequested: safely('withdrawal', async (withdrawalId) => {
      const w = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
      if (!w) return [];
      const raised = [];
      if (w.riskFlags.length >= 2) {
        raised.push(
          await raise({
            userId: w.userId,
            rule: 'WITHDRAWAL_RISK_FLAGS',
            severity: 'MEDIUM',
            summary: `Withdrawal with ${w.riskFlags.length} risk flags`,
            referenceType: 'withdrawal',
            referenceId: w.id,
            details: { flags: w.riskFlags, amountMinor: w.amountMinor.toString() },
          }),
        );
      }
      const hours = await settings.get('monitoring.pass_through_hours');
      const since = new Date(w.createdAt.getTime() - hours * 3_600_000);
      const [deposits, investments] = await Promise.all([
        prisma.deposit.aggregate({
          where: { userId: w.userId, currency: w.currency, status: 'SUCCEEDED', completedAt: { gte: since } },
          _sum: { amountMinor: true },
        }),
        prisma.investmentOrder.count({
          where: { userId: w.userId, createdAt: { gte: since }, status: { notIn: ['CANCELLED', 'REJECTED', 'DRAFT'] } },
        }),
      ]);
      const deposited = deposits._sum.amountMinor ?? 0n;
      if (deposited > 0n && investments === 0 && w.amountMinor * 100n >= deposited * 80n) {
        raised.push(
          await raise({
            userId: w.userId,
            rule: 'PASS_THROUGH',
            severity: 'HIGH',
            summary: `Withdrawal of most of the money deposited in the last ${hours} hours, with no investment`,
            referenceType: 'withdrawal',
            referenceId: w.id,
            details: { withdrawalMinor: w.amountMinor.toString(), depositedMinor: deposited.toString(), hours },
          }),
        );
      }
      return raised.filter(Boolean);
    }),
  };
}
