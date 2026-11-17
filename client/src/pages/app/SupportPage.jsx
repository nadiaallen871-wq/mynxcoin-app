import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
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
  Select,
  Skeleton,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { ReplyBox, Thread } from '../../features/support/Conversation.jsx';
import { TICKET_CATEGORIES, TICKET_STATUS } from '../../features/portfolio/labels.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

function NewRequest({ onDone }) {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [meta, setMeta] = useState({ category: 'ACCOUNT', priority: 'NORMAL', subject: '' });
  const create = useMutation({
    mutationFn: (fd) => {
      Object.entries(meta).forEach(([k, v]) => fd.append(k, v));
      return api.post('/support/tickets', fd);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['support'] });
      toast.success(`Request #${res.data.number} sent`, 'We will reply here and email you when we do.');
      navigate(`/app/support/${res.data.id}`);
    },
  });
  const subjectError = create.error?.details?.find((d) => d.path === 'subject')?.message;
  return (
    <Card className="mb-6">
      <CardHeader title="New request" />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What is it about?">
            {(p) => (
              <Select
                value={meta.category}
                onChange={(e) => setMeta((m) => ({ ...m, category: e.target.value }))}
                options={Object.entries(TICKET_CATEGORIES).map(([value, label]) => ({ value, label }))}
                {...p}
              />
            )}
          </Field>
          <Field label="How urgent?">
            {(p) => (
              <Select
                value={meta.priority}
                onChange={(e) => setMeta((m) => ({ ...m, priority: e.target.value }))}
                options={[
                  { value: 'LOW', label: 'Not urgent' },
                  { value: 'NORMAL', label: 'Normal' },
                  { value: 'HIGH', label: 'Urgent: money is affected' },
                ]}
                {...p}
              />
            )}
          </Field>
        </div>
        {meta.category === 'COMPLAINT' && (
          <Alert tone="info">
            Complaints are logged and tracked until we record how they were resolved. We will acknowledge yours and keep you updated.
          </Alert>
        )}
        <Field label="Subject" error={subjectError} required>
          {(p) => (
            <Input value={meta.subject} maxLength={200} onChange={(e) => setMeta((m) => ({ ...m, subject: e.target.value }))} {...p} />
          )}
        </Field>
        <ReplyBox
          label="Describe the problem"
          submitLabel="Send request"
          pending={create.isPending}
          error={create.error && !subjectError ? create.error : null}
          onSend={async (fd) => {
            try {
              await create.mutateAsync(fd);
              onDone?.();
              return true;
            } catch {
              return false;
            }
          }}
        />
      </CardBody>
    </Card>
  );
}

export default function SupportPage() {
  usePageMeta({ title: 'Support · Mynx' });
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['support', 'tickets'], queryFn: () => api.get('/support/tickets?pageSize=50') });
  return (
    <>
      <PageHeader
        title="Support"
        description="Ask us anything about your account, money or investments."
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" /> New request
            </Button>
          )
        }
      />
      <p className="mb-6 text-sm text-ink-muted">
        Quick answers may already be in our{' '}
        <Link to="/help" className="font-medium text-brand-700 underline">
          help centre
        </Link>
        .
      </p>
      {creating && <NewRequest onDone={() => setCreating(false)} />}
      {list.isPending && <Skeleton className="h-40" />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Your requests"
            rows={list.data.data}
            empty={<EmptyState icon={LifeBuoy} title="No requests yet" description="Requests you send appear here." />}
            columns={[
              { key: 'number', header: 'Request', render: (t) => <span className="font-mono text-xs">#{t.number}</span> },
              {
                key: 'subject',
                header: 'Subject',
                render: (t) => (
                  <Link to={`/app/support/${t.id}`} className="font-medium text-ink hover:underline">
                    {t.subject}
                  </Link>
                ),
              },
              { key: 'category', header: 'Topic', render: (t) => TICKET_CATEGORIES[t.category] },
              {
                key: 'status',
                header: 'Status',
                render: (t) => <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>,
              },
              { key: 'lastActivityAt', header: 'Last update', render: (t) => formatDateTime(t.lastActivityAt) },
            ]}
          />
        </Card>
      )}
    </>
  );
}

export function SupportTicketPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useQuery({ queryKey: ['support', 'ticket', id], queryFn: () => api.get(`/support/tickets/${id}`).then((r) => r.data) });
  usePageMeta({ title: t.data ? `Request #${t.data.number} · Mynx` : 'Support · Mynx' });
  const update = (res) => {
    qc.setQueryData(['support', 'ticket', id], res.data);
    qc.invalidateQueries({ queryKey: ['support', 'tickets'] });
  };
  const reply = useMutation({ mutationFn: (fd) => api.post(`/support/tickets/${id}/messages`, fd), onSuccess: update });
  const close = useMutation({
    mutationFn: () => api.post(`/support/tickets/${id}/close`),
    onSuccess: (res) => {
      update(res);
      toast.success('Request closed');
    },
  });

  if (t.isPending) return <Skeleton className="h-72" />;
  if (t.isError) return <ErrorState error={t.error} onRetry={t.refetch} />;
  const ticket = t.data;
  return (
    <>
      <Link to="/app/support" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" /> All requests
      </Link>
      <PageHeader
        title={ticket.subject}
        description={`Request #${ticket.number} · ${TICKET_CATEGORIES[ticket.category]} · opened ${formatDateTime(ticket.createdAt)}`}
        actions={<Badge tone={TICKET_STATUS[ticket.status].tone}>{TICKET_STATUS[ticket.status].label}</Badge>}
      />
      {ticket.resolution && (
        <Alert tone="success" title="Resolution" className="mb-6">
          {ticket.resolution}
        </Alert>
      )}
      <Card className="mb-6">
        <CardBody>
          <Thread messages={ticket.messages} viewer="customer" />
        </CardBody>
      </Card>
      {ticket.status === 'CLOSED' ? (
        <Alert tone="info">
          This request is closed.{' '}
          <Link to="/app/support" className="font-medium underline">
            Open a new request
          </Link>{' '}
          if you still need help.
        </Alert>
      ) : (
        <Card>
          <CardBody>
            <ReplyBox
              label={ticket.status === 'RESOLVED' ? 'Still need help? Reply to reopen' : 'Reply'}
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
                ticket.status === 'RESOLVED' && (
                  <Button variant="ghost" loading={close.isPending} onClick={() => close.mutate()}>
                    Close request
                  </Button>
                )
              }
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
