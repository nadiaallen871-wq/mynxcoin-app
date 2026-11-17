import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Skeleton,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

export default function FxPage() {
  usePageMeta({ title: 'Currencies · Mynx admin' });
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [proposing, setProposing] = useState(null);
  const rates = useQuery({ queryKey: ['admin', 'fx', 'rates'], queryFn: () => api.get('/admin/fx/rates').then((r) => r.data) });
  const positions = useQuery({ queryKey: ['admin', 'fx', 'positions'], queryFn: () => api.get('/admin/fx/positions').then((r) => r.data) });
  const conversions = useQuery({ queryKey: ['admin', 'fx', 'conversions'], queryFn: () => api.get('/admin/fx/conversions?pageSize=25') });
  const refresh = useMutation({
    mutationFn: () => api.post('/admin/fx/rates/refresh'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'fx'] });
      toast.success('Rates refreshed');
    },
    onError: (e) => toast.error('Could not refresh', e.message),
  });
  const propose = useMutation({
    mutationFn: ({ code, active, reason }) => api.post(`/admin/fx/currencies/${code}/proposals`, { active, reason }),
    onSuccess: () => {
      toast.success('Sent for approval', 'A second person must approve the currency change.');
      setProposing(null);
    },
  });

  if (rates.isPending) return <Skeleton className="h-96" />;
  if (rates.isError) return <ErrorState error={rates.error} onRetry={rates.refetch} />;
  const r = rates.data;
  const rateOf = (code) => r.rates.find((x) => x.currency === code);

  return (
    <>
      <PageHeader
        title="Currencies and exchange"
        description="Each currency has its own ledger accounts; balances are never combined across currencies."
        actions={
          <Button variant="secondary" loading={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh rates
          </Button>
        }
      />
      {r.sandbox && (
        <Alert tone="warning" className="mb-6">
          Rates come from the sandbox provider: fixed illustrative values, not market rates. Connecting a live rate source and an FX licence
          or banking partner is a go-live prerequisite.
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader title="Currencies" description={`Rates show the value of one unit in ${r.anchor}.`} />
        <DataTable
          caption="Currencies"
          rows={r.currencies.map((c) => ({ ...c, id: c.code }))}
          columns={[
            {
              key: 'code',
              header: 'Currency',
              render: (c) => (
                <span className="font-medium text-ink">
                  {c.code} · {c.name}
                </span>
              ),
            },
            {
              key: 'active',
              header: 'Status',
              render: (c) => <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge>,
            },
            {
              key: 'rate',
              header: 'Latest rate',
              render: (c) =>
                c.code === r.anchor ? (
                  'Anchor'
                ) : rateOf(c.code) ? (
                  <span>
                    {rateOf(c.code).rate} {r.anchor}
                    <span className="block text-xs text-ink-subtle">
                      {rateOf(c.code).source} · {formatDateTime(rateOf(c.code).asOf)}
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-subtle">No rate yet</span>
                ),
            },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (c) =>
                c.code !== r.anchor && (
                  <Button size="sm" variant="ghost" onClick={() => setProposing({ code: c.code, active: !c.active, reason: '' })}>
                    {c.active ? 'Request deactivation' : 'Request activation'}
                  </Button>
                ),
            },
          ]}
        />
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="FX reconciliation"
          description="Per currency: the FX clearing balance must equal what conversions paid out minus what they took in. The net position is what treasury squares with a bank."
        />
        {positions.isPending ? (
          <Skeleton className="m-5 h-24" />
        ) : (
          <DataTable
            caption="FX positions"
            rows={(positions.data ?? []).map((p) => ({ ...p, id: p.currency }))}
            columns={[
              { key: 'currency', header: 'Currency', render: (p) => p.currency },
              {
                key: 'in',
                header: 'Received',
                align: 'right',
                render: (p) => money({ amountMinor: p.receivedMinor, currency: p.currency }),
              },
              {
                key: 'out',
                header: 'Paid out',
                align: 'right',
                render: (p) => money({ amountMinor: p.paidOutMinor, currency: p.currency }),
              },
              { key: 'fees', header: 'Fees', align: 'right', render: (p) => money({ amountMinor: p.feesMinor, currency: p.currency }) },
              {
                key: 'balance',
                header: 'Clearing balance',
                align: 'right',
                render: (p) => money({ amountMinor: p.clearingBalanceMinor, currency: p.currency }),
              },
              {
                key: 'ok',
                header: 'Reconciled',
                render: (p) =>
                  p.reconciled ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="size-4" aria-hidden="true" /> Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <XCircle className="size-4" aria-hidden="true" /> No: expected{' '}
                      {money({ amountMinor: p.expectedBalanceMinor, currency: p.currency })}
                    </span>
                  ),
              },
            ]}
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Recent conversions" />
        {conversions.isPending ? (
          <Skeleton className="m-5 h-24" />
        ) : (
          <DataTable
            caption="Recent conversions"
            rows={conversions.data?.data ?? []}
            empty={<EmptyState title="No conversions yet" />}
            columns={[
              { key: 'createdAt', header: 'Date', render: (c) => formatDateTime(c.createdAt) },
              { key: 'user', header: 'Investor', render: (c) => c.user },
              { key: 'from', header: 'Converted', align: 'right', render: (c) => money(c.from) },
              { key: 'fee', header: 'Fee', align: 'right', render: (c) => money(c.fee) },
              { key: 'to', header: 'Received', align: 'right', render: (c) => money(c.to) },
              { key: 'rate', header: 'Rate', align: 'right', render: (c) => <span className="font-mono text-xs">{c.rate}</span> },
            ]}
          />
        )}
      </Card>

      {proposing && (
        <Modal
          open
          onClose={() => setProposing(null)}
          title={`${proposing.active ? 'Activate' : 'Deactivate'} ${proposing.code}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setProposing(null)}>
                Cancel
              </Button>
              <Button loading={propose.isPending} disabled={proposing.reason.trim().length < 10} onClick={() => propose.mutate(proposing)}>
                Request approval
              </Button>
            </>
          }
        >
          {propose.error && (
            <Alert tone="danger" className="mb-3">
              {propose.error.message}
            </Alert>
          )}
          <Field label="Reason (shown to the approver)">
            {(p) => (
              <Textarea
                rows={3}
                value={proposing.reason}
                onChange={(e) => setProposing((x) => ({ ...x, reason: e.target.value }))}
                {...p}
              />
            )}
          </Field>
        </Modal>
      )}
    </>
  );
}
