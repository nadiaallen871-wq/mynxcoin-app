import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Bell, CalendarClock, Info, Landmark, PiggyBank, TrendingUp, Wallet } from 'lucide-react';
import { Alert, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, StatCard } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { displayName, useSession } from '../../features/auth/useSession.js';
import { PRODUCT_TYPES, useMoney } from '../../features/investments/shared.jsx';
import { AllocationBars, ValueHistoryChart } from '../../features/portfolio/charts.jsx';
import { ENTRY_TYPES, KYC_STATUS } from '../../features/portfolio/labels.js';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const btn = 'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium';

export default function DashboardPage() {
  usePageMeta({ title: 'Dashboard · Mynx' });
  const money = useMoney();
  const { data: session } = useSession();
  const dash = useQuery({ queryKey: ['portfolio', 'dashboard'], queryFn: () => api.get('/portfolio/dashboard').then((r) => r.data) });
  const history = useQuery({ queryKey: ['portfolio', 'history'], queryFn: () => api.get('/portfolio/history').then((r) => r.data) });

  if (dash.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (dash.isError) return <ErrorState error={dash.error} onRetry={dash.refetch} />;
  const d = dash.data;
  const p = d.portfolio;
  const kyc = KYC_STATUS[d.verification] ?? KYC_STATUS.NOT_STARTED;
  const returnHint = `${money(p.unrealizedReturn)} estimated, ${money(p.realizedReturn)} realized`;

  return (
    <>
      <PageHeader
        title={`Welcome, ${session?.profile?.firstName ?? displayName(session)}`}
        description={`Figures as of ${formatDateTime(d.asOf)}, calculated from your ledger records.`}
        actions={
          <>
            <Link to="/app/deposit" className={`${btn} bg-navy-900 text-white hover:bg-navy-800`}>
              <ArrowDownLeft className="size-4" aria-hidden="true" /> Deposit
            </Link>
            <Link to="/investments" className={`${btn} border border-border-strong text-ink hover:bg-surface-muted`}>
              <TrendingUp className="size-4" aria-hidden="true" /> Invest
            </Link>
          </>
        }
      />

      {d.verification !== 'APPROVED' && (
        <Alert tone="info" className="mb-6" title={`Identity verification: ${kyc.label}`}>
          You can deposit, invest and withdraw once your identity is verified.{' '}
          <Link to="/app/verification" className="font-medium text-brand-700 underline">
            Go to verification
          </Link>
        </Alert>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total portfolio value" value={money(p.totalValue)} hint="Wallet plus investments" icon={Landmark} />
        <StatCard
          label="Available to invest"
          value={money(d.wallet.available)}
          hint={`${money(d.wallet.reserved)} reserved for orders`}
          icon={Wallet}
        />
        <StatCard
          label="Invested capital"
          value={money(p.investedCapital)}
          hint={`Estimated value ${money(p.holdingsValue)}`}
          icon={PiggyBank}
        />
        <StatCard label="Total return" value={money(p.totalReturn)} hint={returnHint} icon={TrendingUp} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Total value" description="Wallet balance plus investments at their stated valuation, by day." />
          <CardBody>
            {history.isPending ? <Skeleton className="h-60" /> : <ValueHistoryChart points={history.data ?? []} currency={d.currency} />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Allocation" description="Share of investment value by product type." />
          <CardBody>
            <AllocationBars groups={d.allocation.byType} currency={d.currency} labelOf={(g) => PRODUCT_TYPES[g.key] ?? g.label} />
            <dl className="mt-6 grid grid-cols-3 gap-2 border-t border-border pt-4 text-center text-sm">
              {[
                ['Active', d.counts.activeHoldings],
                ['Pending', d.counts.pendingOrders],
                ['Completed', d.counts.completedHoldings],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-ink-subtle">{k}</dt>
                  <dd className="tabular text-lg font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <Link to="/app/investments" className="mt-4 block text-center text-sm font-medium text-brand-700 underline">
              View portfolio
            </Link>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming maturities" />
          {d.upcomingMaturities.length ? (
            <ul className="divide-y divide-border">
              {d.upcomingMaturities.map((m) => (
                <li key={m.holdingId} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{m.product.name}</span>
                    <span className="text-xs text-ink-subtle">
                      {m.maturityDate} · {m.daysToMaturity === 0 ? 'today' : `in ${m.daysToMaturity} days`}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-ink">{money(m.principal)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={CalendarClock} title="Nothing maturing" description="Fixed-term investments appear here." />
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" />
          {d.recentTransactions.length ? (
            <ul className="divide-y divide-border">
              {d.recentTransactions.map((t) => {
                const credit = !t.amount.amountMinor.startsWith('-');
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {credit ? (
                        <ArrowDownLeft className="size-4 shrink-0 text-success" aria-label="Money in" />
                      ) : (
                        <ArrowUpRight className="size-4 shrink-0 text-ink-subtle" aria-label="Money out" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{ENTRY_TYPES[t.type] ?? t.type}</span>
                        <span className="text-xs text-ink-subtle">{formatDateTime(t.postedAt)}</span>
                      </span>
                    </span>
                    <span className="tabular shrink-0 font-medium text-ink">{money(t.amount)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={Wallet} title="No activity yet" />
          )}
          <Link to="/app/transactions" className="block border-t border-border px-5 py-3 text-sm font-medium text-brand-700 underline">
            All transactions
          </Link>
        </Card>

        <Card>
          <CardHeader title="Notifications" description={d.notifications.unread ? `${d.notifications.unread} unread` : 'All caught up'} />
          {d.notifications.latest.length ? (
            <ul className="divide-y divide-border">
              {d.notifications.latest.map((n) => (
                <li key={n.id} className="px-5 py-3 text-sm">
                  <Link to={n.link ?? '/app/notifications'} className="flex items-start gap-2 hover:underline">
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                    <span className="min-w-0">
                      <span className={`block truncate ${n.read ? 'text-ink-muted' : 'font-medium text-ink'}`}>{n.title}</span>
                      <span className="text-xs text-ink-subtle">{formatDateTime(n.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Bell} title="No notifications" />
          )}
          <Link to="/app/notifications" className="block border-t border-border px-5 py-3 text-sm font-medium text-brand-700 underline">
            All notifications
          </Link>
        </Card>
      </div>

      <p className="mt-6 flex items-start gap-2 text-xs text-ink-subtle">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Estimated values accrue interest at each product’s contract rate, less fees so far, and are not guaranteed until the investment is
          settled. Products without a reliable price are shown at cost. Realized returns are proceeds actually received. Sandbox: all
          figures are simulated.
        </span>
      </p>
    </>
  );
}
