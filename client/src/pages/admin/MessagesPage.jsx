import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Select,
  Skeleton,
  Tabs,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { NOTIFICATION_CATEGORIES } from '../../features/portfolio/labels.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const STATUS = {
  QUEUED: { label: 'Queued', tone: 'info' },
  SENT: { label: 'Sent', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

function Log() {
  const toast = useToast();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ status: '', channel: '' });
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const list = useQuery({ queryKey: ['admin', 'messages', qs], queryFn: () => api.get(`/admin/messages?${qs}&pageSize=50`) });
  const retry = useMutation({
    mutationFn: (id) => api.post(`/admin/messages/${id}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'messages'] });
      toast.success('Message re-sent');
    },
    onError: (e) => toast.error('Could not retry', e.message),
  });
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <div className="mb-4 grid max-w-lg gap-3 sm:grid-cols-2">
        <Field label="Status">
          {(p) => (
            <Select
              value={filters.status}
              onChange={set('status')}
              options={[{ value: '', label: 'All' }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))]}
              {...p}
            />
          )}
        </Field>
        <Field label="Channel">
          {(p) => (
            <Select
              value={filters.channel}
              onChange={set('channel')}
              options={[
                { value: '', label: 'All' },
                { value: 'EMAIL', label: 'Email' },
                { value: 'SMS', label: 'SMS' },
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
          <CardHeader
            title="Deliveries"
            description={Object.entries(list.data.meta.byStatus)
              .map(([s, n]) => `${STATUS[s]?.label ?? s}: ${n}`)
              .join(' · ')}
          />
          <DataTable
            caption="Message deliveries"
            rows={list.data.data}
            empty={<EmptyState icon={Mail} title="No messages" />}
            columns={[
              { key: 'createdAt', header: 'Created', render: (m) => formatDateTime(m.createdAt) },
              { key: 'channel', header: 'Channel', render: (m) => m.channel },
              {
                key: 'template',
                header: 'Message',
                render: (m) => (
                  <span>
                    {m.subject ?? m.template}
                    <span className="block font-mono text-xs text-ink-subtle">{m.template}</span>
                  </span>
                ),
              },
              { key: 'recipient', header: 'To', render: (m) => <span className="font-mono text-xs">{m.recipient}</span> },
              {
                key: 'status',
                header: 'Status',
                render: (m) => (
                  <span>
                    <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                    <span className="block text-xs text-ink-subtle">
                      {m.attempts} attempt(s){m.lastError ? ` · ${m.lastError}` : ''}
                    </span>
                  </span>
                ),
              },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                render: (m) =>
                  m.status === 'FAILED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={retry.isPending && retry.variables === m.id}
                      onClick={() => retry.mutate(m.id)}
                    >
                      Retry
                    </Button>
                  ),
              },
            ]}
          />
        </Card>
      )}
    </>
  );
}

function Templates() {
  const t = useQuery({ queryKey: ['admin', 'templates'], queryFn: () => api.get('/admin/messages/templates').then((r) => r.data) });
  if (t.isPending) return <Skeleton className="h-40" />;
  if (t.isError) return <ErrorState error={t.error} onRetry={t.refetch} />;
  return (
    <Card>
      <DataTable
        caption="Message templates"
        rows={t.data.map((x) => ({ ...x, id: x.key }))}
        columns={[
          { key: 'key', header: 'Template', render: (x) => <span className="font-mono text-xs">{x.key}</span> },
          { key: 'category', header: 'Topic', render: (x) => NOTIFICATION_CATEGORIES[x.category] ?? 'Sign-in and verification' },
          { key: 'inApp', header: 'In app', render: (x) => (x.inApp ? 'Yes' : 'No') },
          { key: 'optOut', header: 'Email can be switched off', render: (x) => (x.optOut ? 'Yes' : 'No, always sent') },
        ]}
      />
    </Card>
  );
}

export default function MessagesPage() {
  usePageMeta({ title: 'Messages · Mynx admin' });
  const [tab, setTab] = useState('log');
  return (
    <>
      <PageHeader
        title="Messages"
        description="Email and SMS delivery log. Message bodies are never shown here because they can contain sign-in links or codes."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'log', label: 'Delivery log', content: <Log /> },
          { value: 'templates', label: 'Templates', content: <Templates /> },
        ]}
      />
    </>
  );
}
