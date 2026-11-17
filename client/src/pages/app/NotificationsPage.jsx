import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Lock } from 'lucide-react';
import { Button, Card, CardBody, EmptyState, ErrorState, Skeleton, Tabs } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { NOTIFICATION_CATEGORIES } from '../../features/portfolio/labels.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

function Inbox() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useQuery({
    queryKey: ['notifications', 'list', unreadOnly],
    queryFn: () => api.get(`/notifications?pageSize=50${unreadOnly ? '&unread=true' : ''}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: (ids) => api.post('/notifications/read', { ids }), onSuccess: refresh });
  const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });

  if (list.isPending) return <Skeleton className="h-60" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  const { data, meta } = list.data;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            className="size-4 accent-brand-600"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Unread only ({meta.unread})
        </label>
        <Button size="sm" variant="ghost" disabled={!meta.unread} loading={markAll.isPending} onClick={() => markAll.mutate()}>
          Mark all as read
        </Button>
      </div>
      {data.length ? (
        <ul className="divide-y divide-border">
          {data.map((n) => (
            <li key={n.id} className={`flex items-start gap-3 px-5 py-4 ${n.read ? '' : 'bg-brand-50/40'}`}>
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand-600'}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className={n.read ? 'text-ink' : 'font-semibold text-ink'}>
                    {!n.read && <span className="sr-only">Unread: </span>}
                    {n.title}
                  </span>
                  <span className="text-xs text-ink-subtle">
                    {NOTIFICATION_CATEGORIES[n.category]} · {formatDateTime(n.createdAt)}
                  </span>
                </p>
                <p className="mt-1 text-sm whitespace-pre-line text-ink-muted">{n.body}</p>
                <div className="mt-2 flex gap-4 text-xs">
                  {n.link && (
                    <Link to={n.link} className="font-medium text-brand-700 underline" onClick={() => !n.read && markRead.mutate([n.id])}>
                      Open
                    </Link>
                  )}
                  {!n.read && (
                    <button type="button" className="font-medium text-ink-muted underline" onClick={() => markRead.mutate([n.id])}>
                      Mark as read
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Bell} title={unreadOnly ? 'No unread notifications' : 'No notifications yet'} />
      )}
    </Card>
  );
}

function Preferences() {
  const toast = useToast();
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => api.get('/notifications/preferences').then((r) => r.data),
  });
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (prefs.data) setRows(prefs.data);
  }, [prefs.data]);
  const save = useMutation({
    mutationFn: () =>
      api.put('/notifications/preferences', {
        preferences: rows.map(({ category, email, sms, inApp }) => ({ category, email, sms, inApp })),
      }),
    onSuccess: (res) => {
      qc.setQueryData(['notifications', 'preferences'], res.data);
      toast.success('Preferences saved');
    },
    onError: (e) => toast.error('Could not save', e.message),
  });
  if (prefs.isPending || !rows) return <Skeleton className="h-60" />;
  if (prefs.isError) return <ErrorState error={prefs.error} onRetry={prefs.refetch} />;
  const toggle = (category, channel) => setRows((rs) => rs.map((r) => (r.category === category ? { ...r, [channel]: !r[channel] } : r)));

  return (
    <Card>
      <CardBody>
        <p className="mb-4 text-sm text-ink-muted">
          Choose how we contact you about each topic. SMS goes to your verified phone number. Push notifications are not available yet.
        </p>
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Notification channels by topic</caption>
            <thead className="text-left text-xs text-ink-subtle">
              <tr>
                <th className="py-2 pr-4 font-medium">Topic</th>
                <th className="px-4 py-2 text-center font-medium">In app</th>
                <th className="px-4 py-2 text-center font-medium">Email</th>
                <th className="px-4 py-2 text-center font-medium">SMS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category} className="border-t border-border">
                  <th scope="row" className="py-3 pr-4 text-left font-normal text-ink">
                    {NOTIFICATION_CATEGORIES[r.category]}
                  </th>
                  {['inApp', 'email', 'sms'].map((ch) => {
                    const locked = ch === 'email' && r.emailLocked;
                    return (
                      <td key={ch} className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            className="size-4 accent-brand-600"
                            checked={r[ch]}
                            disabled={locked}
                            aria-label={`${NOTIFICATION_CATEGORIES[r.category]}: ${ch === 'inApp' ? 'in app' : ch}`}
                            onChange={() => toggle(r.category, ch)}
                          />
                          {locked && <Lock className="size-3 text-ink-subtle" aria-label="Always on" />}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-subtle">
          Security and account emails are always sent, so you always hear about sign-ins and changes to your account.
        </p>
        <Button className="mt-4" loading={save.isPending} onClick={() => save.mutate()}>
          Save preferences
        </Button>
      </CardBody>
    </Card>
  );
}

export default function NotificationsPage() {
  usePageMeta({ title: 'Notifications · Mynx' });
  const [params, setParams] = useSearchParams();
  return (
    <>
      <PageHeader title="Notifications" description="Updates about your account, money and investments." />
      <Tabs
        value={params.get('tab') ?? 'inbox'}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        tabs={[
          { value: 'inbox', label: 'Inbox', content: <Inbox /> },
          { value: 'preferences', label: 'Preferences', content: <Preferences /> },
        ]}
      />
    </>
  );
}
