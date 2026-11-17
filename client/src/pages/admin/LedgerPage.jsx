import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from 'lucide-react';
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
  Pagination,
  Select,
  Skeleton,
  Tabs,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api, applyServerErrors } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useMoney } from '../../features/investments/shared.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const ADJ_STATUS = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };
const newKey = () => crypto.randomUUID();

function TrialBalance() {
  const money = useMoney();
  const tb = useQuery({
    queryKey: ['admin', 'ledger', 'trial-balance'],
    queryFn: () => api.get('/admin/ledger/trial-balance?currency=GHS').then((r) => r.data),
  });
  if (tb.isPending) return <Skeleton className="h-64" />;
  if (tb.isError) return <ErrorState error={tb.error} onRetry={tb.refetch} />;
  const m = (minor) => (minor === '0' ? '' : money({ amountMinor: minor, currency: tb.data.currency }));
  return (
    <Card>
      <CardHeader
        title={`Trial balance (${tb.data.currency})`}
        description="Customer wallet accounts are rolled up into control accounts 2000 and 2010."
        actions={
          tb.data.balanced ? (
            <Badge tone="success">
              <CheckCircle2 className="size-3" aria-hidden="true" /> Balanced
            </Badge>
          ) : (
            <Badge tone="danger">
              <XCircle className="size-3" aria-hidden="true" /> Out of balance
            </Badge>
          )
        }
      />
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Trial balance</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs tracking-wide text-ink-subtle uppercase">
              <th scope="col" className="px-5 py-2.5 font-medium">
                Code
              </th>
              <th scope="col" className="px-5 py-2.5 font-medium">
                Account
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                Debit
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                Credit
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tb.data.lines.map((l) => (
              <tr key={`${l.code}-${l.name}`}>
                <td className="px-5 py-2.5 font-mono text-xs text-ink-muted">{l.code}</td>
                <td className="px-5 py-2.5 text-ink">
                  {l.name} <span className="text-xs text-ink-subtle">({l.type.toLowerCase()})</span>
                </td>
                <td className="tabular px-5 py-2.5 text-right">{m(l.debitMinor)}</td>
                <td className="tabular px-5 py-2.5 text-right">{m(l.creditMinor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border-strong font-semibold">
              <td className="px-5 py-3" colSpan={2}>
                Totals
              </td>
              <td className="tabular px-5 py-3 text-right">
                {money({ amountMinor: tb.data.totalDebitsMinor, currency: tb.data.currency })}
              </td>
              <td className="tabular px-5 py-3 text-right">
                {money({ amountMinor: tb.data.totalCreditsMinor, currency: tb.data.currency })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function Journal() {
  const money = useMoney();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const list = useQuery({
    queryKey: ['admin', 'ledger', 'entries', page],
    queryFn: () => api.get(`/admin/ledger/entries?page=${page}&pageSize=25`),
    placeholderData: keepPreviousData,
  });
  if (list.isPending) return <Skeleton className="h-64" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  return (
    <Card>
      <CardHeader title="Journal" description="Posted entries are immutable. Corrections appear as reversal entries." />
      {list.data.data.length === 0 && <EmptyState title="No entries yet" />}
      <ul className="divide-y divide-border">
        {list.data.data.map((e) => {
          const total = e.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
          const expanded = open === e.id;
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : e.id)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-surface-muted"
              >
                {expanded ? (
                  <ChevronDown className="size-4 text-ink-subtle" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-4 text-ink-subtle" aria-hidden="true" />
                )}
                <span className="tabular w-16 font-mono text-xs text-ink-subtle">#{e.entryNumber}</span>
                <Badge tone={e.type === 'REVERSAL' ? 'warning' : 'neutral'} dot={false}>
                  {e.type}
                </Badge>
                <span className="flex-1 truncate text-ink">{e.description}</span>
                <span className="tabular text-ink">{money({ amountMinor: total.toString(), currency: e.lines[0].currency })}</span>
                <span className="hidden w-40 text-right text-xs text-ink-subtle md:block">{formatDateTime(e.postedAt)}</span>
              </button>
              {expanded && (
                <div className="bg-surface-muted/50 px-5 pb-4">
                  <p className="py-2 text-xs text-ink-subtle">
                    Posted by {e.postedBy ?? 'system'} · {e.referenceType ? `${e.referenceType} ${e.referenceId}` : 'no reference'}
                    {e.reversedByEntryId && ' · reversed'}
                  </p>
                  <table className="w-full text-xs">
                    <caption className="sr-only">Lines of entry {e.entryNumber}</caption>
                    <thead>
                      <tr className="text-left text-ink-subtle">
                        <th scope="col" className="py-1 font-medium">
                          Account
                        </th>
                        <th scope="col" className="py-1 text-right font-medium">
                          Debit
                        </th>
                        <th scope="col" className="py-1 text-right font-medium">
                          Credit
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="py-1 text-ink">
                            {l.account.code} {l.account.name}
                            {l.account.ownerUserId && <span className="text-ink-subtle"> (customer)</span>}
                          </td>
                          <td className="tabular py-1 text-right">
                            {l.debitMinor !== '0' && money({ amountMinor: l.debitMinor, currency: l.currency })}
                          </td>
                          <td className="tabular py-1 text-right">
                            {l.creditMinor !== '0' && money({ amountMinor: l.creditMinor, currency: l.currency })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Pagination page={page} pageSize={25} total={list.data.meta.total} onPageChange={setPage} />
    </Card>
  );
}

function NewAdjustment({ open, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ customerEmail: '', direction: 'CREDIT', amount: '', reason: '' });
  const [errors, setErrors] = useState({});
  // One key per intended adjustment: retries after a network error reuse it and cannot create duplicates.
  const [key, setKey] = useState(newKey);
  const create = useMutation({
    mutationFn: () => api.post('/admin/ledger/adjustments', { ...form, currency: 'GHS' }, { headers: { 'Idempotency-Key': key } }),
    onSuccess: () => {
      toast.success('Adjustment requested', 'A second authorised person must approve it.');
      qc.invalidateQueries({ queryKey: ['admin', 'ledger', 'adjustments'] });
      setForm({ customerEmail: '', direction: 'CREDIT', amount: '', reason: '' });
      setKey(newKey());
      onClose();
    },
    onError: (err) => {
      const e = {};
      applyServerErrors(err, (path, v) => (e[path] = v.message));
      setErrors(e);
    },
  });
  const set = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a wallet adjustment"
      description="Nothing is posted until a different authorised person approves. Every adjustment is recorded in the ledger and the audit log."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            Submit for approval
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error && !create.error.details && <Alert tone="danger">{create.error.message}</Alert>}
        <Field label="Investor email" error={errors.customerEmail} required>
          {(p) => <Input type="email" value={form.customerEmail} onChange={set('customerEmail')} {...p} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Direction" required>
            {(p) => (
              <Select
                value={form.direction}
                onChange={set('direction')}
                options={[
                  { value: 'CREDIT', label: 'Credit (add to wallet)' },
                  { value: 'DEBIT', label: 'Debit (remove from wallet)' },
                ]}
                {...p}
              />
            )}
          </Field>
          <Field label="Amount (GHS)" error={errors.amount} required>
            {(p) => <Input inputMode="decimal" value={form.amount} onChange={set('amount')} {...p} />}
          </Field>
        </div>
        <Field label="Reason" hint="Reference the ticket or evidence. Minimum 15 characters." error={errors.reason} required>
          {(p) => <Textarea value={form.reason} onChange={set('reason')} {...p} />}
        </Field>
      </div>
    </Modal>
  );
}

function Adjustments({ session }) {
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState(null);
  const [note, setNote] = useState('');
  const list = useQuery({
    queryKey: ['admin', 'ledger', 'adjustments', status],
    queryFn: () => api.get(`/admin/ledger/adjustments?status=${status}&pageSize=50`),
  });
  const canInitiate = hasPermission(session, 'ledger:adjustment:initiate');
  const canApprove = hasPermission(session, 'ledger:adjustment:approve');
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'ledger'] });
  const decide = useMutation({
    mutationFn: ({ id, action }) =>
      action === 'approve'
        ? api.post(`/admin/ledger/adjustments/${id}/approve`, note ? { note } : {}, { headers: { 'Idempotency-Key': deciding.key } })
        : api.post(`/admin/ledger/adjustments/${id}/reject`, { note }),
    onSuccess: (_r, v) => {
      toast.success(v.action === 'approve' ? 'Approved and posted to the ledger' : 'Rejected');
      setDeciding(null);
      setNote('');
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id) => api.post(`/admin/ledger/adjustments/${id}/cancel`),
    onSuccess: refresh,
    onError: (e) => toast.error('Could not cancel', e.message),
  });

  return (
    <Card>
      <CardHeader
        title="Manual adjustments"
        description="Maker-checker: the requester can never approve their own adjustment."
        actions={canInitiate && <Button onClick={() => setCreating(true)}>New adjustment</Button>}
      />
      <div className="border-b border-border p-4">
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={Object.keys(ADJ_STATUS).map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))}
          className="max-w-48"
        />
      </div>
      {list.isPending && <Skeleton className="m-5 h-32" />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && (
        <DataTable
          caption="Adjustments"
          rows={list.data.data}
          empty={<EmptyState title={`No ${status.toLowerCase()} adjustments`} />}
          columns={[
            {
              key: 'customer',
              header: 'Investor',
              render: (a) => (
                <span>
                  <span className="block text-ink">{a.customer.name}</span>
                  <span className="text-xs text-ink-subtle">{a.customer.email}</span>
                </span>
              ),
            },
            { key: 'amount', header: 'Amount', align: 'right', render: (a) => `${a.direction === 'CREDIT' ? '+' : '−'}${money(a.amount)}` },
            { key: 'reason', header: 'Reason', render: (a) => <span className="line-clamp-2 max-w-xs text-ink-muted">{a.reason}</span> },
            { key: 'requestedBy', header: 'Requested by', render: (a) => `${a.requestedBy.name} · ${formatDateTime(a.createdAt)}` },
            { key: 'status', header: 'Status', render: (a) => <Badge tone={ADJ_STATUS[a.status]}>{a.status.toLowerCase()}</Badge> },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (a) =>
                a.status !== 'PENDING' ? (
                  a.decidedBy && <span className="text-xs text-ink-subtle">by {a.decidedBy.name}</span>
                ) : a.requestedBy.id === session.user.id ? (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate(a.id)}>
                    Cancel
                  </Button>
                ) : (
                  canApprove && (
                    <Button size="sm" variant="secondary" onClick={() => setDeciding({ adjustment: a, key: newKey() })}>
                      Review
                    </Button>
                  )
                ),
            },
          ]}
        />
      )}
      <NewAdjustment open={creating} onClose={() => setCreating(false)} />
      <Modal
        open={Boolean(deciding)}
        onClose={() => (setDeciding(null), decide.reset())}
        title="Review adjustment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeciding(null)}>
              Close
            </Button>
            <Button
              variant="danger"
              disabled={note.trim().length < 5}
              loading={decide.isPending && decide.variables?.action === 'reject'}
              onClick={() => decide.mutate({ id: deciding.adjustment.id, action: 'reject' })}
            >
              Reject
            </Button>
            <Button
              variant="accent"
              loading={decide.isPending && decide.variables?.action === 'approve'}
              onClick={() => decide.mutate({ id: deciding.adjustment.id, action: 'approve' })}
            >
              Approve and post
            </Button>
          </>
        }
      >
        {deciding && (
          <div className="space-y-3 text-sm">
            {decide.error && <Alert tone="danger">{decide.error.message}</Alert>}
            <p>
              <strong>{deciding.adjustment.direction === 'CREDIT' ? 'Credit' : 'Debit'}</strong> {money(deciding.adjustment.amount)}{' '}
              {deciding.adjustment.direction === 'CREDIT' ? 'to' : 'from'} <strong>{deciding.adjustment.customer.email}</strong>
            </p>
            <p className="text-ink-muted">Reason: {deciding.adjustment.reason}</p>
            <p className="text-ink-muted">Requested by {deciding.adjustment.requestedBy.name}</p>
            <Field label="Decision note" hint="Required to reject. Recorded in the audit log.">
              {(p) => <Textarea value={note} onChange={(e) => setNote(e.target.value)} {...p} />}
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function Reconciliation({ session }) {
  const toast = useToast();
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ['admin', 'ledger', 'reconciliations'],
    queryFn: () => api.get('/admin/ledger/reconciliations?pageSize=20'),
  });
  const run = useMutation({
    mutationFn: () => api.post('/admin/ledger/reconciliations'),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin', 'ledger', 'reconciliations'] });
      if (res.data.status === 'PASSED') toast.success('Reconciliation passed');
      else toast.error('Reconciliation found discrepancies', `${res.data.discrepancies.length} issue(s)`);
    },
  });
  return (
    <Card>
      <CardHeader
        title="Ledger reconciliation"
        description="Checks that every entry balances, cached balances match their lines, no customer account is negative, and each currency nets to zero. Runs daily at 02:00 UTC."
        actions={
          hasPermission(session, 'reconciliation:run') && (
            <Button variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
              Run now
            </Button>
          )
        }
      />
      {runs.isPending && <Skeleton className="m-5 h-32" />}
      {runs.isError && <ErrorState error={runs.error} onRetry={runs.refetch} />}
      {runs.data && (
        <DataTable
          caption="Reconciliation runs"
          rows={runs.data.data}
          empty={<EmptyState title="No runs yet" />}
          columns={[
            { key: 'startedAt', header: 'Started', render: (r) => formatDateTime(r.startedAt) },
            {
              key: 'status',
              header: 'Result',
              render: (r) => <Badge tone={r.status === 'PASSED' ? 'success' : 'danger'}>{r.status.toLowerCase()}</Badge>,
            },
            {
              key: 'checked',
              header: 'Checked',
              render: (r) => `${r.summary.entriesChecked} entries · ${r.summary.accountsChecked} accounts`,
            },
            {
              key: 'issues',
              header: 'Discrepancies',
              render: (r) =>
                r.discrepancies.length === 0 ? (
                  '—'
                ) : (
                  <span className="text-xs text-danger">
                    {r.discrepancies
                      .slice(0, 3)
                      .map((d) => d.check)
                      .join(', ')}
                    {r.discrepancies.length > 3 && ` +${r.discrepancies.length - 3}`}
                  </span>
                ),
            },
            { key: 'triggeredBy', header: 'Triggered by', render: (r) => r.triggeredBy },
          ]}
        />
      )}
    </Card>
  );
}

export default function LedgerPage() {
  usePageMeta({ title: 'Ledger · Mynx Admin' });
  const { data: session } = useSession();
  const [tab, setTab] = useState('trial');
  return (
    <>
      <PageHeader title="Ledger" description="Double-entry ledger. Balances are derived from immutable journal entries." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'trial', label: 'Trial balance', content: <TrialBalance /> },
          { value: 'journal', label: 'Journal', content: <Journal /> },
          { value: 'adjustments', label: 'Adjustments', content: <Adjustments session={session} /> },
          { value: 'reconciliation', label: 'Reconciliation', content: <Reconciliation session={session} /> },
        ]}
      />
      <CardBody className="px-0 text-xs text-ink-subtle">Sandbox ledger: amounts are simulated.</CardBody>
    </>
  );
}
