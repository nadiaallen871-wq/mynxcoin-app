import { useQuery } from '@tanstack/react-query';
import { Mail, MessageSquare } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';

/**
 * Development-only view of the sandbox outbox, so email verification, password
 * reset and SMS codes can be completed locally. Neither this page nor its API
 * route exists outside development.
 */
export default function OutboxPage() {
  const outbox = useQuery({
    queryKey: ['dev', 'outbox'],
    queryFn: () => api.get('/dev/outbox').then((r) => r.data),
    refetchInterval: 3000,
  });
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Sandbox outbox</h1>
      <p className="mt-1 text-ink-muted">Emails and SMS the platform would have sent. Refreshes every 3 seconds.</p>
      <Alert tone="warning" className="mt-4">
        Development only. Messages are never delivered to real inboxes in sandbox mode.
      </Alert>
      <div className="mt-6 space-y-4">
        {outbox.isPending && <Skeleton className="h-40" />}
        {outbox.isError && <ErrorState error={outbox.error} onRetry={outbox.refetch} />}
        {outbox.data?.length === 0 && (
          <Card>
            <EmptyState title="No messages yet" description="Register an account or request a password reset." />
          </Card>
        )}
        {outbox.data?.map((m) => (
          <Card key={m.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium text-ink">
                {m.channel === 'SMS' ? (
                  <MessageSquare className="size-4" aria-hidden="true" />
                ) : (
                  <Mail className="size-4" aria-hidden="true" />
                )}
                {m.subject ?? 'SMS'} <span className="font-normal text-ink-subtle">→ {m.recipient}</span>
              </p>
              <span className="flex items-center gap-2 text-xs text-ink-subtle">
                <Badge tone={m.status === 'SENT' ? 'success' : m.status === 'FAILED' ? 'danger' : 'warning'}>{m.status}</Badge>
                {formatDateTime(m.createdAt)}
              </span>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-xs whitespace-pre-wrap text-ink">
              {m.body?.split(/(https?:\/\/\S+)/g).map((part, i) =>
                /^https?:\/\//.test(part) ? (
                  <a key={i} href={part} className="break-all text-brand-700 underline">
                    {part}
                  </a>
                ) : (
                  part
                ),
              )}
            </pre>
          </Card>
        ))}
      </div>
    </div>
  );
}
