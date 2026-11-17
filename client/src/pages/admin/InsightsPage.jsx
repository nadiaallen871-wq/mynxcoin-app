import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Skeleton, Tabs } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { AllocationBars } from '../../features/portfolio/charts.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const share = (b) => `${(b / 100).toFixed(1)}%`;
const BAND = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' };

function Kpis() {
  const money = useMoney();
  const q = useQuery({ queryKey: ['admin', 'kpis'], queryFn: () => api.get('/admin/insights/kpis?months=12').then((r) => r.data) });
  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const top = q.data.funnel[0].count || 1;
  const m = (minor) => money({ amountMinor: minor, currency: q.data.currency });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Investor funnel" description="All time. Each stage counts people, not transactions." />
        <CardBody>
          <ul className="space-y-3">
            {q.data.funnel.map((f) => (
              <li key={f.stage}>
                <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-sm">
                  <span className="text-ink">{f.stage}</span>
                  <span className="tabular text-ink-muted">
                    {f.count} · {((f.count / top) * 100).toFixed(0)}% of registered
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface-muted" aria-hidden="true">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${Math.max((f.count / top) * 100, 1)}%`, background: 'var(--color-brand-600)' }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Monthly figures"
          description={`${q.data.currency}. Investments under management are principal of open holdings at month end.`}
        />
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Monthly KPIs</caption>
            <thead className="text-left text-xs text-ink-subtle">
              <tr>
                {['Month', 'New investors', 'Verified', 'Deposits', 'Withdrawals', 'Net flow', 'Invested', 'Under management'].map(
                  (h, i) => (
                    <th key={h} className={`px-5 py-2 font-medium whitespace-nowrap ${i ? 'text-right' : ''}`}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="tabular">
              {q.data.monthly.map((r) => (
                <tr key={r.month} className="border-t border-border">
                  <th scope="row" className="px-5 py-2 text-left font-normal">
                    {r.month}
                  </th>
                  <td className="px-5 py-2 text-right">{r.newInvestors}</td>
                  <td className="px-5 py-2 text-right">{r.verified}</td>
                  <td className="px-5 py-2 text-right whitespace-nowrap">{m(r.depositsMinor)}</td>
                  <td className="px-5 py-2 text-right whitespace-nowrap">{m(r.withdrawalsMinor)}</td>
                  <td className="px-5 py-2 text-right whitespace-nowrap">{m(r.netFlowMinor)}</td>
                  <td className="px-5 py-2 text-right whitespace-nowrap">{m(r.investedMinor)}</td>
                  <td className="px-5 py-2 text-right whitespace-nowrap">{m(r.aumEndOfMonthMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Concentration() {
  const q = useQuery({ queryKey: ['admin', 'concentration'], queryFn: () => api.get('/admin/insights/concentration').then((r) => r.data) });
  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const groups = (rows) => rows.map((g) => ({ key: g.key, label: g.label, valueMinor: g.principalMinor, shareBasisPoints: g.shareBps }));
  const flagged = [...d.byProduct, ...d.byIssuer].filter((g) => g.flagged);
  return (
    <div className="space-y-6">
      {flagged.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Above the {share(d.thresholdBps)} concentration threshold: {flagged.map((g) => `${g.label} (${share(g.shareBps)})`).join(', ')}
        </p>
      )}
      {!BigInt(d.totalMinor) ? (
        <EmptyState title="No open investments" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            ['By product', d.byProduct],
            ['By issuer', d.byIssuer],
            ['By risk level', d.byRiskLevel],
          ].map(([title, rows]) => (
            <Card key={title}>
              <CardHeader title={title} />
              <CardBody>
                <AllocationBars groups={groups(rows)} currency={d.currency} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <CardHeader title="Product limits" description="Investor count and how much of each product's capacity is used." />
        <DataTable
          caption="Product limits"
          rows={d.byProduct.map((g) => ({ ...g, id: g.key }))}
          empty={<EmptyState title="No open investments" />}
          columns={[
            { key: 'label', header: 'Product', render: (g) => g.label },
            { key: 'investors', header: 'Investors', align: 'right', render: (g) => g.investors },
            { key: 'share', header: 'Share of total', align: 'right', render: (g) => share(g.shareBps) },
            {
              key: 'cap',
              header: 'Capacity used',
              align: 'right',
              render: (g) => (g.capacityUsedBps === null ? 'No cap' : share(g.capacityUsedBps)),
            },
            {
              key: 'flag',
              header: <span className="sr-only">Flag</span>,
              render: (g) => g.flagged && <Badge tone="warning">Concentrated</Badge>,
            },
          ]}
        />
      </Card>
    </div>
  );
}

function RiskScores() {
  const q = useQuery({ queryKey: ['admin', 'risk-scores'], queryFn: () => api.get('/admin/insights/risk-scores').then((r) => r.data) });
  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <Card>
      <CardHeader
        title="Highest risk scores"
        description="A rule-based ranking for review, not a decision. Every point has a stated reason."
      />
      <DataTable
        caption="Risk scores"
        rows={q.data.map((s) => ({ ...s, id: s.userId }))}
        empty={<EmptyState title="No one with risk signals" />}
        columns={[
          {
            key: 'name',
            header: 'Person',
            render: (s) => (
              <Link to={`/admin/users/${s.userId}`} className="hover:underline">
                {s.name}
                <span className="block text-xs text-ink-subtle">{s.email}</span>
              </Link>
            ),
          },
          { key: 'score', header: 'Score', align: 'right', render: (s) => <Badge tone={BAND[s.band]}>{s.score}</Badge> },
          {
            key: 'factors',
            header: 'Why',
            render: (s) => (
              <ul className="space-y-0.5 text-xs text-ink-muted">
                {s.factors.map((f) => (
                  <li key={f.reason}>
                    +{f.points} {f.reason}
                  </li>
                ))}
              </ul>
            ),
          },
          { key: 'at', header: 'Computed', render: (s) => formatDateTime(s.computedAt) },
        ]}
      />
    </Card>
  );
}

function Fees() {
  const money = useMoney();
  const q = useQuery({ queryKey: ['admin', 'fees'], queryFn: () => api.get('/admin/insights/fees').then((r) => r.data) });
  if (q.isPending) return <Skeleton className="h-60" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Platform fees" description="Changed through System settings, with a second approver." />
        <ul className="divide-y divide-border">
          {q.data.platform.map((f) => (
            <li key={f.fee} className="flex flex-wrap justify-between gap-x-4 px-5 py-3 text-sm">
              <span className="font-medium text-ink">{f.fee}</span>
              <span className="text-ink-muted">{f.amount ? `${money(f.amount)} · ${f.basis}` : f.basis}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Product fees" description={q.data.note} />
        <DataTable
          caption="Product fees"
          rows={q.data.products.map((p) => ({ ...p, id: p.slug }))}
          empty={<EmptyState title="No products" />}
          columns={[
            { key: 'name', header: 'Product', render: (p) => p.name },
            { key: 'status', header: 'Status', render: (p) => p.status },
            { key: 'version', header: 'Terms version', align: 'right', render: (p) => `v${p.termsVersion}` },
            { key: 'entry', header: 'Entry fee', align: 'right', render: (p) => `${p.entryFeePercent}%` },
            { key: 'mgmt', header: 'Management fee (yearly)', align: 'right', render: (p) => `${p.managementFeePercent}%` },
          ]}
        />
      </Card>
      <p className="text-xs text-ink-subtle">
        Fees collected over a period are in{' '}
        <Link to="/admin/reports" className="underline">
          Reports → Financial summary
        </Link>
        .
      </p>
    </div>
  );
}

export default function InsightsPage() {
  usePageMeta({ title: 'Insights · Mynx admin' });
  const { data: session } = useSession();
  const tabs = [
    { value: 'kpis', label: 'KPIs', content: <Kpis /> },
    { value: 'concentration', label: 'Concentration', content: <Concentration /> },
    ...(hasPermission(session, 'compliance:cases:read') ? [{ value: 'risk', label: 'Risk scores', content: <RiskScores /> }] : []),
    { value: 'fees', label: 'Fee schedule', content: <Fees /> },
  ];
  const [tab, setTab] = useState('kpis');
  return (
    <>
      <PageHeader
        title="Insights"
        description="Business, risk and fee views built from the ledger and settled records. Figures are per currency."
      />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
    </>
  );
}
