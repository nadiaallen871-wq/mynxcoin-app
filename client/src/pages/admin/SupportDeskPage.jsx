import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LifeBuoy, Plus } from 'lucide-react';
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
  Select,
  Skeleton,
  StatCard,
  Tabs,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { ReplyBox, Thread } from '../../features/support/Conversation.jsx';
import { TICKET_CATEGORIES, TICKET_PRIORITY, TICKET_STATUS } from '../../features/portfolio/labels.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const statusLabel = (s) => TICKET_STATUS[s].staffLabel ?? TICKET_STATUS[s].label;
const options = (map, label = (v) => v) => Object.entries(map).map(([value, v]) => ({ value, label: label(v, value) }));
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const duration = (min) =>
  min === null ? '—' : min < 60 ? `${min} min` : min < 1440 ? `${(min / 60).toFixed(1)} h` : `${(min / 1440).toFixed(1)} days`;

function Queue() {
  const [filters, setFilters] = useState({ status: '', priority: '', assignee: '' });
  const qs = new URLSearchParams(Object.entries({ ...filters, pageSize: '50' }).filter(([, v]) => v)).toString();
  const list = useQuery({ queryKey: ['admin', 'support', 'queue', filters], queryFn: () => api.get(`/admin/support/tickets?${qs}`) });
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Status">
          {(p) => (
            <Select
              value={filters.status}
              onChange={set('status')}
              options={[{ value: '', label: 'All open' }, ...options(TICKET_STATUS, (_v, k) => statusLabel(k))]}
              {...p}
            />
          )}
        </Field>
        <Field label="Priority">
          {(p) => (
            <Select
              value={filters.priority}
              onChange={set('priority')}
              options={[{ value: '', label: 'Any' }, ...options(TICKET_PRIORITY, (v) => v.label)]}
              {...p}
            />
          )}
        </Field>
        <Field label="Assigned to">
          {(p) => (
            <Select
              value={filters.assignee}
              onChange={set('assignee')}
              options={[
                { value: '', label: 'Anyone' },
                { value: 'me', label: 'Me' },
                { value: 'unassigned', label: 'Unassigned' },
              ]}
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
            caption="Support queue"
            rows={list.data.data}
            empty={<EmptyState icon={LifeBuoy} title="Queue is clear" />}
            columns={[
              { key: 'number', header: '#', render: (t) => <span className="font-mono text-xs">{t.number}</span> },
              {
                key: 'subject',
                header: 'Subject',
                render: (t) => (
                  <span>
                    <Link to={`/admin/support/${t.id}`} className="font-medium text-ink hover:underline">
                      {t.subject}
                    </Link>
                    <span className="block text-xs text-ink-subtle">
                      {t.customer?.name} · {TICKET_CATEGORIES[t.category]}
                    </span>
                  </span>
                ),
              },
              {
                key: 'priority',
                header: 'Priority',
                render: (t) => (
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={TICKET_PRIORITY[t.priority].tone}>{TICKET_PRIORITY[t.priority].label}</Badge>
                    {t.isComplaint && <Badge tone="danger">Complaint</Badge>}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (t) => <Badge tone={TICKET_STATUS[t.status].tone}>{statusLabel(t.status)}</Badge>,
              },
              {
                key: 'assignee',
                header: 'Assignee',
                render: (t) => t.assignee?.name ?? <span className="text-ink-subtle">Unassigned</span>,
              },
              { key: 'lastActivityAt', header: 'Last activity', render: (t) => formatDateTime(t.lastActivityAt) },
            ]}
          />
        </Card>
      )}
    </>
  );
}

function Report() {
  const [range, setRange] = useState({ from: daysAgo(30), to: today() });
  const r = useQuery({
    queryKey: ['admin', 'support', 'report', range],
    queryFn: () => api.get(`/admin/support/report?from=${range.from}&to=${range.to}`).then((x) => x.data),
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Field label="From" className="w-40">
          {(p) => (
            <Input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setRange((x) => ({ ...x, from: e.target.value }))}
              {...p}
            />
          )}
        </Field>
        <Field label="To" className="w-40">
          {(p) => (
            <Input type="date" value={range.to} max={today()} onChange={(e) => setRange((x) => ({ ...x, to: e.target.value }))} {...p} />
          )}
        </Field>
      </div>
      {r.isPending && <Skeleton className="h-40" />}
      {r.isError && <ErrorState error={r.error} onRetry={r.refetch} />}
      {r.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Tickets created" value={String(r.data.created)} />
            <StatCard
              label="Average first response"
              value={duration(r.data.avgFirstResponseMinutes)}
              hint={`${r.data.awaitingFirstResponse} still waiting`}
            />
            <StatCard label="Average resolution" value={duration(r.data.avgResolutionMinutes)} />
            <StatCard label="Complaints" value={String(r.data.complaints.total)} hint={`${r.data.complaints.open} unresolved`} />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            {[
              ['By status', r.data.byStatus, (k) => statusLabel(k)],
              ['By topic', r.data.byCategory, (k) => TICKET_CATEGORIES[k]],
              ['Resolved by agent', Object.fromEntries(r.data.resolvedByAgent.map((a) => [a.agent, a.resolved])), (k) => k],
            ].map(([title, counts, label]) => (
              <Card key={title}>
                <CardHeader title={title} />
                <ul className="divide-y divide-border">
                  {Object.entries(counts).length ? (
                    Object.entries(counts).map(([k, v]) => (
                      <li key={k} className="flex justify-between px-5 py-2 text-sm">
                        <span className="text-ink-muted">{label(k)}</span>
                        <span className="tabular font-medium text-ink">{v}</span>
                      </li>
                    ))
                  ) : (
                    <li className="px-5 py-4 text-sm text-ink-subtle">None</li>
                  )}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FaqManager() {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const list = useQuery({ queryKey: ['admin', 'faqs'], queryFn: () => api.get('/admin/support/faqs').then((r) => r.data) });
  const save = useMutation({
    mutationFn: ({ id, ...body }) => (id ? api.put(`/admin/support/faqs/${id}`, body) : api.post('/admin/support/faqs', body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'faqs'] });
      qc.invalidateQueries({ queryKey: ['faqs'] });
      toast.success('FAQ saved');
      setEditing(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/admin/support/faqs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'faqs'] });
      setEditing(null);
    },
  });
  if (list.isPending) return <Skeleton className="h-40" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  const set = (k) => (e) => setEditing((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing({ category: '', question: '', answer: '', published: false, sortOrder: 0 })}>
          <Plus className="size-4" aria-hidden="true" /> New question
        </Button>
      </div>
      <Card>
        <DataTable
          caption="FAQ entries"
          rows={list.data}
          empty={<EmptyState title="No FAQ entries yet" />}
          columns={[
            { key: 'category', header: 'Topic', render: (f) => f.category },
            {
              key: 'question',
              header: 'Question',
              render: (f) => (
                <button type="button" className="text-left font-medium text-ink hover:underline" onClick={() => setEditing(f)}>
                  {f.question}
                </button>
              ),
            },
            {
              key: 'published',
              header: 'Status',
              render: (f) => <Badge tone={f.published ? 'success' : 'neutral'}>{f.published ? 'Published' : 'Draft'}</Badge>,
            },
            { key: 'updatedAt', header: 'Updated', render: (f) => formatDateTime(f.updatedAt) },
          ]}
        />
      </Card>
      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit question' : 'New question'}
          footer={
            <>
              {editing.id && (
                <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(editing.id)}>
                  Delete
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                loading={save.isPending}
                onClick={() =>
                  save.mutate({
                    id: editing.id,
                    category: editing.category,
                    question: editing.question,
                    answer: editing.answer,
                    published: editing.published,
                    sortOrder: Number(editing.sortOrder) || 0,
                  })
                }
              >
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {save.error && <Alert tone="danger">{save.error.message}</Alert>}
            <Field label="Topic">
              {(p) => <Input value={editing.category} onChange={set('category')} placeholder="e.g. Deposits" {...p} />}
            </Field>
            <Field label="Question">{(p) => <Input value={editing.question} onChange={set('question')} {...p} />}</Field>
            <Field label="Answer">{(p) => <Textarea rows={6} value={editing.answer} onChange={set('answer')} {...p} />}</Field>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" className="size-4 accent-brand-600" checked={editing.published} onChange={set('published')} />
                Published
              </label>
              <Field label="Order" className="w-24">
                {(p) => <Input type="number" min={0} value={editing.sortOrder} onChange={set('sortOrder')} {...p} />}
              </Field>
            </div>
            <p className="text-xs text-ink-subtle">
              Published answers are public. Do not promise returns or give personal financial advice.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function SupportDeskPage() {
  usePageMeta({ title: 'Support · Mynx admin' });
  const { data: session } = useSession();
  const [tab, setTab] = useState('queue');
  return (
    <>
      <PageHeader
        title="Support"
        description="Customer requests, complaints and help content. Agents see contact details only, never balances or identity documents."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'queue', label: 'Queue', content: <Queue /> },
          { value: 'report', label: 'Performance', content: <Report /> },
          ...(hasPermission(session, 'support:faq:manage') ? [{ value: 'faq', label: 'FAQ', content: <FaqManager /> }] : []),
        ]}
      />
    </>
  );
}

export function SupportTicketAdminPage() {
  const { id } = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canManage = hasPermission(session, 'support:tickets:manage');
  const [internal, setInternal] = useState(false);
  const [resolving, setResolving] = useState(null);
  const t = useQuery({
    queryKey: ['admin', 'support', 'ticket', id],
    queryFn: () => api.get(`/admin/support/tickets/${id}`).then((r) => r.data),
  });
  const agents = useQuery({
    queryKey: ['admin', 'support', 'agents'],
    queryFn: () => api.get('/admin/support/agents').then((r) => r.data),
    enabled: canManage,
  });
  usePageMeta({ title: t.data ? `#${t.data.number} · Support` : 'Support' });
  const done = (res) => {
    qc.setQueryData(['admin', 'support', 'ticket', id], res.data);
    qc.invalidateQueries({ queryKey: ['admin', 'support', 'queue'] });
  };
  const reply = useMutation({
    mutationFn: (fd) => {
      fd.append('internal', String(internal));
      return api.post(`/admin/support/tickets/${id}/messages`, fd);
    },
    onSuccess: done,
  });
  const update = useMutation({
    mutationFn: (body) => api.patch(`/admin/support/tickets/${id}`, body),
    onSuccess: (res) => {
      done(res);
      setResolving(null);
      toast.success('Ticket updated');
    },
    onError: (e) => !resolving && toast.error('Could not update', e.message),
  });

  if (t.isPending) return <Skeleton className="h-72" />;
  if (t.isError) return <ErrorState error={t.error} onRetry={t.refetch} />;
  const ticket = t.data;
  const closed = ticket.status === 'CLOSED';
  return (
    <>
      <Link to="/admin/support" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" /> Queue
      </Link>
      <PageHeader
        title={ticket.subject}
        description={`#${ticket.number} · ${TICKET_CATEGORIES[ticket.category]} · opened ${formatDateTime(ticket.createdAt)}`}
        actions={
          <span className="flex flex-wrap gap-1">
            {ticket.isComplaint && <Badge tone="danger">Complaint</Badge>}
            <Badge tone={TICKET_STATUS[ticket.status].tone}>{statusLabel(ticket.status)}</Badge>
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardBody>
              <Thread messages={ticket.messages} viewer="staff" />
            </CardBody>
          </Card>
          {canManage && !closed && (
            <Card>
              <CardBody>
                <ReplyBox
                  label={internal ? 'Internal note (never shown to the customer)' : 'Reply to customer'}
                  submitLabel={internal ? 'Add note' : 'Send reply'}
                  pending={reply.isPending}
                  error={reply.error}
                  onSend={async (fd) => {
                    try {
                      await reply.mutateAsync(fd);
                      return true;
                    } catch {
                      return false;
                    }
                  }}
                  extra={
                    <label className="flex items-center gap-2 text-sm text-ink-muted">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-600"
                        checked={internal}
                        onChange={(e) => setInternal(e.target.checked)}
                      />
                      Internal note
                    </label>
                  }
                />
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Customer" />
            <CardBody className="space-y-1 text-sm">
              <p className="font-medium text-ink">{ticket.customer.name}</p>
              <p className="text-ink-muted">{ticket.customer.email}</p>
              <p className="text-xs text-ink-subtle">
                {ticket.customer.type === 'INSTITUTIONAL' ? 'Institutional' : 'Individual'} investor · {ticket.customerOtherTickets} other
                request(s)
              </p>
              <p className="pt-2 text-xs text-ink-subtle">
                Financial and identity details are not available to support. Escalate to finance or compliance if needed.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Handling" />
            <CardBody className="space-y-4">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-subtle">First response</dt>
                  <dd>{ticket.firstResponseAt ? formatDateTime(ticket.firstResponseAt) : 'Not yet'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-subtle">Resolved</dt>
                  <dd>{ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : '—'}</dd>
                </div>
              </dl>
              {canManage && !closed && (
                <>
                  <Field label="Status">
                    {(p) => (
                      <Select
                        value={ticket.status}
                        onChange={(e) =>
                          ['RESOLVED', 'CLOSED'].includes(e.target.value)
                            ? setResolving({ status: e.target.value, resolution: ticket.resolution ?? '' })
                            : update.mutate({ status: e.target.value })
                        }
                        options={options(TICKET_STATUS, (_v, k) => statusLabel(k))}
                        {...p}
                      />
                    )}
                  </Field>
                  <Field label="Priority">
                    {(p) => (
                      <Select
                        value={ticket.priority}
                        onChange={(e) => update.mutate({ priority: e.target.value })}
                        options={options(TICKET_PRIORITY, (v) => v.label)}
                        {...p}
                      />
                    )}
                  </Field>
                  <Field label="Assignee">
                    {(p) => (
                      <Select
                        value={ticket.assignee?.id ?? ''}
                        onChange={(e) => update.mutate({ assigneeId: e.target.value || null })}
                        options={[{ value: '', label: 'Unassigned' }, ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name }))]}
                        {...p}
                      />
                    )}
                  </Field>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      {resolving && (
        <Modal
          open
          onClose={() => setResolving(null)}
          title={resolving.status === 'CLOSED' ? 'Close ticket' : 'Resolve ticket'}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResolving(null)}>
                Cancel
              </Button>
              <Button
                loading={update.isPending}
                onClick={() =>
                  update.mutate({ status: resolving.status, ...(resolving.resolution ? { resolution: resolving.resolution } : {}) })
                }
              >
                {resolving.status === 'CLOSED' ? 'Close' : 'Resolve'}
              </Button>
            </>
          }
        >
          {update.error && (
            <Alert tone="danger" className="mb-3">
              {update.error.details?.[0]?.message ?? update.error.message}
            </Alert>
          )}
          <Field label={ticket.isComplaint ? 'Resolution (required for complaints)' : 'Resolution (optional, shown to the customer)'}>
            {(p) => (
              <Textarea
                rows={4}
                value={resolving.resolution}
                onChange={(e) => setResolving((r) => ({ ...r, resolution: e.target.value }))}
                {...p}
              />
            )}
          </Field>
        </Modal>
      )}
    </>
  );
}
