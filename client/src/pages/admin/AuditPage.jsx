import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ScrollText } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, Field, Input, Modal, Pagination, Skeleton } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api, BASE } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const EMPTY = { actor: '', action: '', entityType: '', entityId: '', from: '', to: '' };

function Detail({ id, onClose }) {
  const q = useQuery({ queryKey: ['admin', 'audit', id], queryFn: () => api.get(`/admin/audit/${id}`).then((r) => r.data) });
  const block = (label, v) =>
    v !== null &&
    v !== undefined && (
      <div>
        <p className="mb-1 text-xs font-medium text-ink-subtle">{label}</p>
        <pre className="max-h-60 overflow-auto rounded-lg bg-surface-muted p-3 text-xs">{JSON.stringify(v, null, 2)}</pre>
      </div>
    );
  return (
    <Modal open onClose={onClose} title={`Audit entry #${id}`} size="lg">
      {q.isPending && <Skeleton className="h-40" />}
      {q.data && (
        <div className="space-y-4 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            {[
              ['Time', formatDateTime(q.data.createdAt)],
              ['Actor', q.data.actor],
              ['Action', q.data.action],
              ['Entity', `${q.data.entityType}${q.data.entityId ? `: ${q.data.entityId}` : ''}`],
              ['IP address', q.data.ipAddress ?? '—'],
              ['Request ID', q.data.requestId ?? '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-ink-subtle">{k}</dt>
                <dd className="font-mono text-xs break-all text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {block('Before', q.data.before)}
          {block('After', q.data.after)}
          {block('Details', q.data.metadata)}
        </div>
      )}
    </Modal>
  );
}

export default function AuditPage() {
  usePageMeta({ title: 'Audit log · Mynx admin' });
  const [form, setForm] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const list = useQuery({ queryKey: ['admin', 'audit', qs, page], queryFn: () => api.get(`/admin/audit?${qs}&page=${page}&pageSize=50`) });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every security, financial and administrative action. Entries cannot be changed or deleted."
        actions={
          <a
            href={`${BASE}/api/v1/admin/audit/export?${qs}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border-strong px-4 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            <Download className="size-4" aria-hidden="true" /> Export CSV
          </a>
        }
      />
      <form
        className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-7 lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters(form);
        }}
      >
        <Field label="Actor email contains">{(p) => <Input value={form.actor} onChange={set('actor')} {...p} />}</Field>
        <Field label="Action starts with">
          {(p) => <Input value={form.action} onChange={set('action')} placeholder="e.g. withdrawal." {...p} />}
        </Field>
        <Field label="Entity type">
          {(p) => <Input value={form.entityType} onChange={set('entityType')} placeholder="e.g. user" {...p} />}
        </Field>
        <Field label="Entity ID">{(p) => <Input value={form.entityId} onChange={set('entityId')} {...p} />}</Field>
        <Field label="From">{(p) => <Input type="date" value={form.from} onChange={set('from')} {...p} />}</Field>
        <Field label="To">{(p) => <Input type="date" value={form.to} onChange={set('to')} {...p} />}</Field>
        <div className="flex flex-wrap gap-2 sm:col-span-3 lg:col-span-1">
          <Button type="submit">Filter</Button>
          <Button
            variant="ghost"
            onClick={() => {
              setForm(EMPTY);
              setFilters(EMPTY);
              setPage(1);
            }}
          >
            Clear
          </Button>
        </div>
      </form>
      {list.isPending && <Skeleton className="h-60" />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Audit entries"
            rows={list.data.data}
            empty={<EmptyState icon={ScrollText} title="No entries match" />}
            columns={[
              { key: 'createdAt', header: 'Time', render: (r) => formatDateTime(r.createdAt) },
              {
                key: 'action',
                header: 'Action',
                render: (r) => (
                  <button type="button" className="font-mono text-xs text-brand-700 underline" onClick={() => setOpen(r.id)}>
                    {r.action}
                  </button>
                ),
              },
              { key: 'actor', header: 'Actor', render: (r) => r.actor },
              {
                key: 'entity',
                header: 'Entity',
                render: (r) => (
                  <span className="font-mono text-xs break-all">
                    {r.entityType}
                    {r.entityId ? `: ${r.entityId}` : ''}
                  </span>
                ),
              },
              { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ipAddress ?? '—'}</span> },
            ]}
          />
          <Pagination page={page} pageSize={50} total={list.data.meta.total} onPageChange={setPage} />
        </Card>
      )}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
