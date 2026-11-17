import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
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
import { DEPOSIT_STATUS, RISK_FLAGS, WITHDRAWAL_STATUS, newIdempotencyKey } from '../../features/payments/status.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const ACTIONS = {
  approve: { title: 'Approve and pay out', label: 'Approve and send', note: 'Note (optional)', needsNote: false, idem: true },
  reject: { title: 'Reject withdrawal', label: 'Reject', note: 'Reason shown to the investor', needsNote: true, tone: 'danger' },
  retry: { title: 'Retry payout', label: 'Retry payout', idem: true, noNote: true },
  return: { title: 'Return funds to wallet', label: 'Return to wallet', note: 'Reason (optional)', needsNote: false },
};

function WithdrawalAction({ action, withdrawal, onClose }) {
  const cfg = ACTIONS[action];
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [key] = useState(newIdempotencyKey);
  const run = useMutation({
    mutationFn: () =>
      api.post(
        `/admin/payments/withdrawals/${withdrawal.id}/${action}`,
        cfg.noNote ? {} : note ? { note } : {},
        cfg.idem ? { headers: { 'Idempotency-Key': key } } : undefined,
      ),
    onSuccess: (res) => {
      const s = res.data.status;
      toast[s === 'FAILED' ? 'error' : 'success'](
        `Withdrawal ${WITHDRAWAL_STATUS[s].label.toLowerCase()}`,
        res.data.failureReason ?? undefined,
      );
      qc.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={cfg.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={cfg.tone === 'danger' ? 'danger' : 'primary'}
            loading={run.isPending}
            disabled={cfg.needsNote && note.trim().length < 5}
            onClick={() => run.mutate()}
          >
            {cfg.label}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        {money(withdrawal.amount)} to {withdrawal.destination} for {withdrawal.user?.name ?? withdrawal.user?.email}.
        {action === 'approve' && ' The payout is sent to the provider straight away.'}
      </p>
      {run.error && (
        <Alert tone="danger" className="mt-3">
          {run.error.message}
        </Alert>
      )}
      {!cfg.noNote && (
        <Field label={cfg.note} className="mt-4" required={cfg.needsNote}>
          {(p) => <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} {...p} />}
        </Field>
      )}
    </Modal>
  );
}

function Withdrawals() {
  const money = useMoney();
  const { data: session } = useSession();
  const canApprove = hasPermission(session, 'withdrawals:approve');
  const [status, setStatus] = useState('REQUESTED');
  const [acting, setActing] = useState(null);
  const list = useQuery({
    queryKey: ['admin', 'withdrawals', status],
    queryFn: () => api.get(`/admin/payments/withdrawals?pageSize=50${status ? `&status=${status}` : ''}`),
  });
  const btn = (w, action, label, variant = 'ghost') => (
    <Button size="sm" variant={variant} onClick={() => setActing({ action, withdrawal: w })}>
      {label}
    </Button>
  );
  return (
    <>
      <div className="mb-4 max-w-xs">
        <Field label="Status">
          {(p) => (
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[{ value: '', label: 'All' }, ...Object.entries(WITHDRAWAL_STATUS).map(([value, s]) => ({ value, label: s.label }))]}
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
            caption="Withdrawals"
            rows={list.data.data}
            empty={<EmptyState icon={Banknote} title="Nothing here" description="No withdrawals with this status." />}
            columns={[
              { key: 'createdAt', header: 'Requested', render: (w) => formatDateTime(w.createdAt) },
              {
                key: 'user',
                header: 'Investor',
                render: (w) => (
                  <span>
                    {w.user?.name}
                    <span className="block text-xs text-ink-subtle">{w.user?.email}</span>
                  </span>
                ),
              },
              { key: 'destination', header: 'To', render: (w) => <span className="text-xs">{w.destination}</span> },
              {
                key: 'flags',
                header: 'Risk flags',
                render: (w) =>
                  w.riskFlags?.length ? (
                    <span className="flex flex-wrap gap-1">
                      {w.riskFlags.map((f) => (
                        <Badge key={f} tone="warning">
                          {RISK_FLAGS[f] ?? f}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-subtle">None</span>
                  ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (w) => (
                  <span>
                    <Badge tone={WITHDRAWAL_STATUS[w.status].tone}>{WITHDRAWAL_STATUS[w.status].label}</Badge>
                    {w.failureReason && <span className="mt-1 block text-xs text-ink-subtle">{w.failureReason}</span>}
                  </span>
                ),
              },
              { key: 'amount', header: 'Amount', align: 'right', render: (w) => money(w.amount) },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                render: (w) =>
                  canApprove && (
                    <span className="flex justify-end gap-1">
                      {w.status === 'REQUESTED' && (
                        <>
                          {btn(w, 'approve', 'Approve', 'primary')}
                          {btn(w, 'reject', 'Reject')}
                        </>
                      )}
                      {w.status === 'FAILED' && (
                        <>
                          {btn(w, 'retry', 'Retry', 'primary')}
                          {btn(w, 'return', 'Return')}
                        </>
                      )}
                    </span>
                  ),
              },
            ]}
          />
        </Card>
      )}
      {acting && <WithdrawalAction {...acting} onClose={() => setActing(null)} />}
    </>
  );
}

function Deposits() {
  const money = useMoney();
  const list = useQuery({ queryKey: ['admin', 'deposits'], queryFn: () => api.get('/admin/payments/deposits?pageSize=50') });
  if (list.isPending) return <Skeleton className="h-40" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  return (
    <Card>
      <DataTable
        caption="Deposits"
        rows={list.data.data}
        empty={<EmptyState icon={Banknote} title="No deposits yet" />}
        columns={[
          { key: 'createdAt', header: 'Date', render: (d) => formatDateTime(d.createdAt) },
          {
            key: 'user',
            header: 'Investor',
            render: (d) => (
              <span>
                {d.user?.name}
                <span className="block text-xs text-ink-subtle">{d.user?.email}</span>
              </span>
            ),
          },
          { key: 'reference', header: 'Reference', render: (d) => <span className="font-mono text-xs">{d.reference}</span> },
          { key: 'provider', header: 'Provider', render: (d) => d.provider },
          {
            key: 'status',
            header: 'Status',
            render: (d) => <Badge tone={DEPOSIT_STATUS[d.status].tone}>{DEPOSIT_STATUS[d.status].label}</Badge>,
          },
          { key: 'fee', header: 'Fee', align: 'right', render: (d) => (d.fee ? money(d.fee) : '—') },
          { key: 'amount', header: 'Amount', align: 'right', render: (d) => money(d.amount) },
        ]}
      />
    </Card>
  );
}

export default function PaymentsPage() {
  usePageMeta({ title: 'Payments · Mynx admin' });
  const { data: session } = useSession();
  const [tab, setTab] = useState('withdrawals');
  const tabs = [
    { value: 'withdrawals', label: 'Withdrawals', content: <Withdrawals /> },
    ...(hasPermission(session, 'deposits:read:any') ? [{ value: 'deposits', label: 'Deposits', content: <Deposits /> }] : []),
  ];
  return (
    <>
      <PageHeader
        title="Payments"
        description="Review withdrawals before payout and follow deposit settlement. Every decision is audited."
      />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
    </>
  );
}
