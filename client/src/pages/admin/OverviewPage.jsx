import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, CheckCircle2, ClipboardList, ShieldAlert, Users } from 'lucide-react';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, StatCard } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { PENDING_LABELS } from '../../features/admin/labels.js';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const sum = (obj) => Object.values(obj ?? {}).reduce((a, b) => a + b, 0);

export default function OverviewPage() {
  usePageMeta({ title: 'Overview · Mynx admin' });
  const money = useMoney();
  const q = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.get('/admin/overview').then((r) => r.data),
    refetchInterval: 60_000,
  });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const pending = Object.entries(d.pending).filter(([, n]) => n > 0);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Platform status as of ${formatDateTime(d.asOf)}. You see the sections your role covers.`}
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Waiting for you" description="Items your role can act on." />
          {pending.length ? (
            <ul className="divide-y divide-border">
              {pending.map(([key, n]) => (
                <li key={key}>
                  <Link to={PENDING_LABELS[key].to} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-surface-muted">
                    <span className="text-ink">{PENDING_LABELS[key].label}</span>
                    <span className="tabular rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">{n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={CheckCircle2} title="Nothing waiting" />
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {d.users && (
            <StatCard
              label="Investors"
              value={String((d.users.byType.INDIVIDUAL ?? 0) + (d.users.byType.INSTITUTIONAL ?? 0))}
              hint={`${d.users.newInvestors30d} new in 30 days · ${d.users.byType.STAFF ?? 0} staff · ${d.users.byStatus.SUSPENDED ?? 0} suspended`}
              icon={Users}
            />
          )}
          {d.kyc && (
            <StatCard
              label="Verified investors"
              value={String(d.kyc.byStatus.APPROVED ?? 0)}
              hint={`${d.kyc.awaitingReview} awaiting review`}
              icon={CheckCircle2}
            />
          )}
          {d.money && (
            <>
              <StatCard
                label="Customer money held"
                value={money(d.money.customerWalletLiability)}
                hint={`Plus ${money(d.money.customerHoldings)} in investments`}
                icon={Banknote}
              />
              <StatCard
                label="Deposits (30 days)"
                value={money(d.money.deposits30d)}
                hint={`${d.money.deposits30d.count} deposits · withdrawals ${money(d.money.withdrawals30d)}`}
                icon={Banknote}
              />
            </>
          )}
          {d.investments && (
            <StatCard
              label="Active investments"
              value={money(d.investments.activeHoldings)}
              hint={`${d.investments.activeHoldings.count} holdings · ${d.investments.maturitiesDue} maturities due · ${d.investments.publishedProducts} products live`}
              icon={ClipboardList}
            />
          )}
          {d.compliance && (
            <StatCard
              label="Open monitoring alerts"
              value={String(sum(d.compliance.openAlerts))}
              hint={`${d.compliance.openAlerts.HIGH ?? 0} high · ${d.compliance.openCases} open cases`}
              icon={ShieldAlert}
            />
          )}
        </div>
      </div>

      {d.money && (
        <Card className="mb-6">
          <CardHeader title="Financial summary" description="From settled records and ledger balances." />
          <CardBody>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Deposits, all time', money(d.money.depositsAllTime)],
                ['Withdrawals, all time', money(d.money.withdrawalsAllTime)],
                ['Withdrawals waiting for review', `${money(d.money.pendingWithdrawals)} (${d.money.pendingWithdrawals.count})`],
                ['Fee income, all time', money(d.money.feeIncome)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-ink-subtle">{k}</dt>
                  <dd className="tabular mt-1 font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            {(d.money.alerts.failedPayouts > 0 || d.money.alerts.failedDeposits7d > 0) && (
              <p className="mt-4 flex items-center gap-2 text-sm text-danger">
                <AlertTriangle className="size-4" aria-hidden="true" />
                {d.money.alerts.failedPayouts} failed payout(s) need a retry or return · {d.money.alerts.failedDeposits7d} failed deposit(s)
                in the last 7 days
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {d.recentActivity && (
        <Card>
          <CardHeader title="Recent activity" description="Latest audit log entries." />
          <ul className="divide-y divide-border">
            {d.recentActivity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 px-5 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-mono text-xs text-ink">{a.action}</span>
                  <span className="text-ink-muted"> · {a.actor}</span>
                </span>
                <span className="text-xs text-ink-subtle">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
          <Link to="/admin/audit" className="block border-t border-border px-5 py-3 text-sm font-medium text-brand-700 underline">
            Open the audit log
          </Link>
        </Card>
      )}
    </>
  );
}
