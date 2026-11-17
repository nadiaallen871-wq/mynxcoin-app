import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Tabs,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { RISK_PROFILES } from '../../features/kyc/labels.js';
import { HOLDING_STATUS, ORDER_STATUS, newIdempotencyKey } from '../../features/payments/status.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

function ActionModal({ title, label, tone, onClose, onSubmit, pending, error, disabled, children }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={pending} disabled={disabled} onClick={onSubmit}>
            {label}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-3">
          {error.message}
        </Alert>
      )}
      <div className="space-y-4">{children}</div>
    </Modal>
  );
}

function OrderAction({ action, order, onClose }) {
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(newIdempotencyKey);
  const confirm = action === 'confirm';
  const run = useMutation({
    mutationFn: () =>
      confirm
        ? api.post(
            `/admin/orders/${order.id}/confirm`,
            { custodianReference: ref, ...(note ? { notes: note } : {}) },
            { headers: { 'Idempotency-Key': key } },
          )
        : api.post(`/admin/orders/${order.id}/reject`, { note }),
    onSuccess: () => {
      toast.success(
        confirm ? 'Order confirmed' : 'Order rejected',
        confirm ? 'The holding is now active.' : 'The reserved amount was released.',
      );
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      onClose();
    },
  });
  return (
    <ActionModal
      title={confirm ? `Confirm order #${order.orderNumber}` : `Reject order #${order.orderNumber}`}
      label={confirm ? 'Confirm allocation' : 'Reject order'}
      tone={confirm ? 'primary' : 'danger'}
      onClose={onClose}
      onSubmit={() => run.mutate()}
      pending={run.isPending}
      error={run.error}
      disabled={confirm ? ref.trim().length < 3 : note.trim().length < 5}
    >
      <p className="text-sm text-ink-muted">
        {money(order.amount)} into {order.product.name} for {order.investor?.name ?? order.investor?.email}. Fee {money(order.fee)},
        invested {money(order.invested)}.
      </p>
      {confirm ? (
        <>
          <Field
            label="Custodian or issuer allocation reference"
            required
            hint="Only confirm once the allocation exists with the custodian or issuer."
          >
            {(p) => <Input value={ref} onChange={(e) => setRef(e.target.value)} {...p} />}
          </Field>
          <Field label="Notes (optional)">
            {(p) => <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} {...p} />}
          </Field>
        </>
      ) : (
        <Field label="Reason shown to the investor" required>
          {(p) => <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} {...p} />}
        </Field>
      )}
    </ActionModal>
  );
}

function SettleHolding({ holding, onClose }) {
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [proceeds, setProceeds] = useState('');
  const [ref, setRef] = useState('');
  const [key] = useState(newIdempotencyKey);
  const run = useMutation({
    mutationFn: () =>
      api.post(
        `/admin/holdings/${holding.id}/settle`,
        { proceeds: proceeds.replace(/,/g, ''), custodianReference: ref },
        { headers: { 'Idempotency-Key': key } },
      ),
    onSuccess: () => {
      toast.success('Maturity settled', 'Proceeds, less any management fee, were credited to the investor’s wallet.');
      qc.invalidateQueries({ queryKey: ['admin', 'holdings'] });
      onClose();
    },
  });
  return (
    <ActionModal
      title="Settle maturity"
      label="Settle and credit wallet"
      onClose={onClose}
      onSubmit={() => run.mutate()}
      pending={run.isPending}
      error={run.error}
      disabled={!/^\d+(\.\d{1,4})?$/.test(proceeds.replace(/,/g, '')) || ref.trim().length < 3}
    >
      <p className="text-sm text-ink-muted">
        {holding.product.name} for {holding.investor.name ?? holding.investor.email}. Principal {money(holding.principal)}, matured{' '}
        {holding.maturityDate}.
      </p>
      <Field
        label={`Actual proceeds received (${holding.principal.currency})`}
        required
        hint="Enter what the custodian actually paid. Never a projected figure."
      >
        {(p) => <Input inputMode="decimal" value={proceeds} onChange={(e) => setProceeds(e.target.value)} {...p} />}
      </Field>
      <Field label="Custodian settlement reference" required>
        {(p) => <Input value={ref} onChange={(e) => setRef(e.target.value)} {...p} />}
      </Field>
    </ActionModal>
  );
}

function Orders({ canManage }) {
  const money = useMoney();
  const [status, setStatus] = useState('PENDING');
  const [acting, setActing] = useState(null);
  const list = useQuery({
    queryKey: ['admin', 'orders', status],
    queryFn: () => api.get(`/admin/orders?pageSize=50${status ? `&status=${status}` : ''}`),
  });
  return (
    <>
      <div className="mb-4 max-w-xs">
        <Field label="Status">
          {(p) => (
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[{ value: '', label: 'All' }, ...Object.entries(ORDER_STATUS).map(([value, s]) => ({ value, label: s.label }))]}
              {...p}
            />
          )}
        </Field>
      </div>
      {list.isPending && <Skeleton className="h-40" />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Investment orders"
            rows={list.data.data}
            empty={<EmptyState icon={ClipboardList} title="Nothing here" description="No orders with this status." />}
            columns={[
              { key: 'orderNumber', header: 'Order', render: (o) => <span className="font-mono text-xs">#{o.orderNumber}</span> },
              { key: 'createdAt', header: 'Placed', render: (o) => formatDateTime(o.createdAt) },
              {
                key: 'investor',
                header: 'Investor',
                render: (o) => (
                  <span>
                    {o.investor?.name}
                    <span className="block text-xs text-ink-subtle">{o.investor?.email}</span>
                  </span>
                ),
              },
              {
                key: 'product',
                header: 'Investment',
                render: (o) => (
                  <span>
                    {o.product.name}
                    {o.unsuitableAcknowledged && (
                      <Badge tone="warning" className="mt-1 flex w-fit">
                        Unsuitable, acknowledged ({RISK_PROFILES[o.investorRiskProfile] ?? o.investorRiskProfile})
                      </Badge>
                    )}
                  </span>
                ),
              },
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
                  canManage &&
                  o.status === 'PENDING' && (
                    <span className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => setActing({ action: 'confirm', order: o })}>
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setActing({ action: 'reject', order: o })}>
                        Reject
                      </Button>
                    </span>
                  ),
              },
            ]}
          />
        </Card>
      )}
      {acting && <OrderAction {...acting} onClose={() => setActing(null)} />}
    </>
  );
}

function DueHoldings({ canManage }) {
  const money = useMoney();
  const [settling, setSettling] = useState(null);
  const list = useQuery({ queryKey: ['admin', 'holdings', 'due'], queryFn: () => api.get('/admin/holdings/due').then((r) => r.data) });
  if (list.isPending) return <Skeleton className="h-40" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  return (
    <>
      <Card>
        <DataTable
          caption="Holdings due for settlement"
          rows={list.data}
          empty={<EmptyState icon={ClipboardList} title="No maturities due" description="Holdings appear here on their maturity date." />}
          columns={[
            { key: 'product', header: 'Investment', render: (h) => h.product.name },
            {
              key: 'investor',
              header: 'Investor',
              render: (h) => (
                <span>
                  {h.investor.name}
                  <span className="block text-xs text-ink-subtle">{h.investor.email}</span>
                </span>
              ),
            },
            { key: 'maturity', header: 'Matured', render: (h) => h.maturityDate },
            {
              key: 'status',
              header: 'Status',
              render: (h) => <Badge tone={HOLDING_STATUS[h.status].tone}>{HOLDING_STATUS[h.status].label}</Badge>,
            },
            { key: 'principal', header: 'Principal', align: 'right', render: (h) => money(h.principal) },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (h) =>
                canManage && (
                  <Button size="sm" onClick={() => setSettling(h)}>
                    Settle
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      {settling && <SettleHolding holding={settling} onClose={() => setSettling(null)} />}
    </>
  );
}

export default function OrdersPage() {
  usePageMeta({ title: 'Orders · Mynx admin' });
  const { data: session } = useSession();
  const canManage = hasPermission(session, 'investments:orders:manage');
  const [tab, setTab] = useState('orders');
  return (
    <>
      <PageHeader
        title="Investment orders"
        description="Confirm allocations with the custodian or issuer, and settle maturities with the proceeds actually received."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'orders', label: 'Orders', content: <Orders canManage={canManage} /> },
          { value: 'maturities', label: 'Maturities due', content: <DueHoldings canManage={canManage} /> },
        ]}
      />
    </>
  );
}
