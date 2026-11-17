import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Download, FileText, PiggyBank, TrendingUp } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Skeleton,
  StatCard,
  Tabs,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { AllocationBars, ValueHistoryChart } from '../../features/portfolio/charts.jsx';
import { ENTRY_TYPES, VALUATION } from '../../features/portfolio/labels.js';
import { HOLDING_STATUS, ORDER_STATUS } from '../../features/payments/status.js';
import { useGenerateDocument } from '../../features/statements/useDocuments.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const today = () => new Date().toISOString().slice(0, 10);
const startOfYear = () => `${new Date().getUTCFullYear()}-01-01`;

function RolloverModal({ holding, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [accepted, setAccepted] = useState(false);
  const enable = !holding.rollover;
  const save = useMutation({
    mutationFn: () =>
      api.post(
        `/investments/holdings/${holding.id}/rollover`,
        enable ? { enabled: true, acceptRiskDisclosure: accepted } : { enabled: false },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success(enable ? 'Reinvestment requested' : 'Reinvestment cancelled');
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={enable ? 'Reinvest at maturity' : 'Stop reinvesting'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={enable && !accepted} onClick={() => save.mutate()}>
            {enable ? 'Reinvest at maturity' : 'Pay proceeds to my wallet'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-muted">
        {save.error && <Alert tone="danger">{save.error.message}</Alert>}
        {enable ? (
          <>
            <p>
              When {holding.product.name} matures on {holding.maturityDate}, the proceeds after fees will be used to place a new order in
              the same product, under today’s terms. Our team confirms it like any order, and you can cancel it while it is pending.
            </p>
            <p>If the product’s terms change before then, or it is not open, nothing is reinvested and the money goes to your wallet.</p>
            <label className="flex items-start gap-2 text-ink">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-brand-600"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>I have read the current risk disclosure and fees for this product and understand I could lose money.</span>
            </label>
          </>
        ) : (
          <p>The proceeds will be paid into your wallet at maturity.</p>
        )}
      </div>
    </Modal>
  );
}

function Holdings() {
  const money = useMoney();
  const [rollover, setRollover] = useState(null);
  const holdings = useQuery({ queryKey: ['portfolio', 'holdings'], queryFn: () => api.get('/portfolio/holdings').then((r) => r.data) });
  if (holdings.isPending) return <Skeleton className="h-40" />;
  if (holdings.isError) return <ErrorState error={holdings.error} onRetry={holdings.refetch} />;
  return (
    <Card>
      <DataTable
        caption="Holdings"
        rows={holdings.data}
        empty={<EmptyState icon={Briefcase} title="No holdings yet" description="Confirmed investments appear here." />}
        columns={[
          {
            key: 'product',
            header: 'Investment',
            render: (h) => (
              <span>
                <Link to={`/investments/${h.product.slug}`} className="font-medium text-ink hover:underline">
                  {h.product.name}
                </Link>
                <span className="block text-xs text-ink-subtle">
                  {h.annualRatePercent ? `${h.annualRatePercent}% p.a. ${h.returnType === 'FIXED' ? 'fixed' : 'target'}` : 'Variable'} ·
                  order #{h.orderNumber}
                </span>
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (h) => <Badge tone={HOLDING_STATUS[h.status].tone}>{HOLDING_STATUS[h.status].label}</Badge>,
          },
          {
            key: 'dates',
            header: 'Term',
            render: (h) => (
              <span className="text-xs">
                {h.startDate} → {h.maturityDate ?? 'open-ended'}
              </span>
            ),
          },
          { key: 'principal', header: 'Principal', align: 'right', render: (h) => money(h.principal) },
          {
            key: 'value',
            header: 'Value',
            align: 'right',
            render: (h) => (
              <span title={VALUATION[h.valuationMethod].hint}>
                {h.valuationMethod === 'SETTLED' ? money(h.proceeds) : money(h.value)}
                <span className="block">
                  <Badge tone={VALUATION[h.valuationMethod].tone} dot={false}>
                    {VALUATION[h.valuationMethod].label}
                  </Badge>
                </span>
              </span>
            ),
          },
          {
            key: 'return',
            header: 'Return',
            align: 'right',
            render: (h) =>
              h.valuationMethod === 'SETTLED'
                ? `${money(h.realized)} realized`
                : h.valuationMethod === 'ACCRUED'
                  ? `${money(h.unrealized)} est.`
                  : '—',
          },
          {
            key: 'rollover',
            header: 'At maturity',
            align: 'right',
            render: (h) =>
              h.status === 'ACTIVE' && h.maturityDate ? (
                <Button size="sm" variant="ghost" onClick={() => setRollover(h)}>
                  {h.rollover ? 'Reinvest (change)' : 'Pay to wallet (change)'}
                </Button>
              ) : (
                h.rolloverNote && <span className="text-xs text-ink-subtle">{h.rolloverNote}</span>
              ),
          },
        ]}
      />
      {rollover && <RolloverModal holding={rollover} onClose={() => setRollover(null)} />}
    </Card>
  );
}

function Orders() {
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const generate = useGenerateDocument();
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api.get('/investments/orders?pageSize=50') });
  const cancel = useMutation({
    mutationFn: (id) => api.post(`/investments/orders/${id}/cancel`),
    onSuccess: () => {
      toast.success('Order cancelled', 'The reserved amount is back in your available balance.');
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      qc.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e) => toast.error('Could not cancel', e.message),
  });
  if (orders.isPending) return <Skeleton className="h-40" />;
  if (orders.isError) return <ErrorState error={orders.error} onRetry={orders.refetch} />;
  return (
    <Card>
      <DataTable
        caption="Orders"
        rows={orders.data.data}
        empty={<EmptyState title="No orders yet" />}
        columns={[
          { key: 'orderNumber', header: 'Order', render: (o) => <span className="font-mono text-xs">#{o.orderNumber}</span> },
          { key: 'product', header: 'Investment', render: (o) => o.product.name },
          { key: 'createdAt', header: 'Placed', render: (o) => formatDateTime(o.createdAt) },
          {
            key: 'status',
            header: 'Status',
            render: (o) => <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>,
          },
          { key: 'amount', header: 'Amount', align: 'right', render: (o) => money(o.amount) },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (o) =>
              o.status === 'PENDING' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={cancel.isPending && cancel.variables === o.id}
                  onClick={() => cancel.mutate(o.id)}
                >
                  Cancel
                </Button>
              ) : o.confirmedAt ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={generate.isPending && generate.variables?.referenceId === o.id}
                  onClick={() => generate.mutate({ kind: 'INVESTMENT_CONFIRMATION', referenceId: o.id })}
                >
                  <Download className="size-4" aria-hidden="true" /> Confirmation
                </Button>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}

function Analytics() {
  const money = useMoney();
  const [range, setRange] = useState({ from: startOfYear(), to: today() });
  const [applied, setApplied] = useState(range);
  const generate = useGenerateDocument();
  const a = useQuery({
    queryKey: ['portfolio', 'analytics', applied],
    queryFn: () => api.get(`/portfolio/analytics?from=${applied.from}&to=${applied.to}`).then((r) => r.data),
  });
  const months = a.data ? [...new Set(a.data.cashFlows.map((f) => f.month))] : [];
  const types = a.data ? [...new Set(a.data.cashFlows.map((f) => f.type))] : [];
  const cell = (m, t) => a.data.cashFlows.find((f) => f.month === m && f.type === t)?.netMinor;

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(range);
        }}
      >
        <Field label="From" className="w-40">
          {(p) => (
            <Input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              {...p}
            />
          )}
        </Field>
        <Field label="To" className="w-40">
          {(p) => (
            <Input type="date" value={range.to} max={today()} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} {...p} />
          )}
        </Field>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        <Button
          variant="ghost"
          loading={generate.isPending}
          onClick={() => generate.mutate({ kind: 'TRANSACTION_REPORT', format: 'CSV', from: applied.from, to: applied.to })}
        >
          <Download className="size-4" aria-hidden="true" /> Transactions CSV
        </Button>
      </form>

      {a.isPending && <Skeleton className="h-64" />}
      {a.isError && <ErrorState error={a.error} onRetry={a.refetch} />}
      {a.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Realized return"
              value={money(a.data.realizedTotal)}
              hint="Matured in this period, after fees"
              icon={TrendingUp}
            />
            <StatCard
              label="Unrealized return"
              value={money(a.data.unrealizedNow)}
              hint="Estimated, on holdings still open"
              icon={PiggyBank}
            />
            <StatCard
              label="Fees paid"
              value={money(a.data.fees.total)}
              hint={`Entry ${money(a.data.fees.entry)} · management ${money(a.data.fees.management)} · withdrawal ${money(a.data.fees.withdrawal)}`}
              icon={FileText}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="Total value in this period" />
              <CardBody>
                <ValueHistoryChart points={a.data.history} currency={a.data.currency} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Risk exposure" description="Investment value by product risk level (1 lowest, 7 highest)." />
              <CardBody>
                <AllocationBars groups={a.data.riskExposure} currency={a.data.currency} />
                {a.data.riskMetrics.holdings > 0 && (
                  <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4 text-center text-xs">
                    {[
                      ['Average risk', `${a.data.riskMetrics.weightedRiskLevel} of 7`],
                      [`Risk ${a.data.riskMetrics.highRiskLevel}+`, `${(a.data.riskMetrics.highRiskShareBps / 100).toFixed(1)}%`],
                      ['Largest holding', `${(a.data.riskMetrics.largestHoldingShareBps / 100).toFixed(1)}%`],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-ink-subtle">{k}</dt>
                        <dd className="tabular mt-0.5 text-sm font-semibold text-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title="Cash flows" description="Net movement on your available balance by month. Money in is positive." />
            {months.length ? (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Cash flows by month and type</caption>
                  <thead className="text-left text-xs text-ink-subtle">
                    <tr>
                      <th className="px-5 py-2 font-medium">Type</th>
                      {months.map((m) => (
                        <th key={m} className="px-5 py-2 text-right font-medium">
                          {m}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {types.map((t) => (
                      <tr key={t} className="border-t border-border">
                        <th scope="row" className="px-5 py-2 text-left font-normal text-ink">
                          {ENTRY_TYPES[t] ?? t}
                        </th>
                        {months.map((m) => (
                          <td key={m} className="px-5 py-2 text-right">
                            {cell(m, t) ? money({ amountMinor: cell(m, t), currency: a.data.currency }) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No movements in this period" />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export default function MyInvestmentsPage() {
  usePageMeta({ title: 'Portfolio · Mynx' });
  const money = useMoney();
  const [tab, setTab] = useState('holdings');
  const generate = useGenerateDocument();
  const dash = useQuery({ queryKey: ['portfolio', 'dashboard'], queryFn: () => api.get('/portfolio/dashboard').then((r) => r.data) });

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Your holdings, orders and performance. Estimated values are not guaranteed until settled."
        actions={
          <Button variant="secondary" loading={generate.isPending} onClick={() => generate.mutate({ kind: 'PORTFOLIO_STATEMENT' })}>
            <Download className="size-4" aria-hidden="true" /> Portfolio statement
          </Button>
        }
      />
      {dash.isPending && <Skeleton className="mb-6 h-28" />}
      {dash.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Investments value"
            value={money(dash.data.portfolio.holdingsValue)}
            hint="At stated valuation"
            icon={Briefcase}
          />
          <StatCard
            label="Invested capital"
            value={money(dash.data.portfolio.investedCapital)}
            hint="Active holdings, after entry fees"
            icon={PiggyBank}
          />
          <StatCard label="Unrealized return" value={money(dash.data.portfolio.unrealizedReturn)} hint="Estimated" icon={TrendingUp} />
          <StatCard
            label="Pending orders"
            value={String(dash.data.counts.pendingOrders)}
            hint={`${money(dash.data.counts.pendingAmount)} reserved`}
            icon={FileText}
          />
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'holdings', label: 'Holdings', content: <Holdings /> },
          { value: 'orders', label: 'Orders', content: <Orders /> },
          { value: 'analytics', label: 'Analytics', content: <Analytics /> },
        ]}
      />
    </>
  );
}
