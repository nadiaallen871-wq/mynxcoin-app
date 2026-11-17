import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
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
  Skeleton,
  Tabs,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { APPROVAL_STATUS, APPROVAL_TYPES } from '../../features/admin/labels.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

function RequestList({ query, canDecide }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [deciding, setDeciding] = useState(null);
  const list = useQuery({ queryKey: ['admin', 'approvals', query], queryFn: () => api.get(`/admin/approvals?${query}&pageSize=50`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });
  const decide = useMutation({
    mutationFn: ({ id, approve, note }) => api.post(`/admin/approvals/${id}/decide`, { approve, note }),
    onSuccess: (res) => {
      refresh();
      setDeciding(null);
      const s = res.data.status;
      if (s === 'FAILED') toast.error('Not applied', res.data.error);
      else toast.success(APPROVAL_STATUS[s].label);
    },
  });
  const cancel = useMutation({
    mutationFn: (id) => api.post(`/admin/approvals/${id}/cancel`),
    onSuccess: refresh,
    onError: (e) => toast.error('Could not withdraw', e.message),
  });

  if (list.isPending) return <Skeleton className="h-40" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  return (
    <>
      <Card>
        <DataTable
          caption="Approval requests"
          rows={list.data.data}
          empty={<EmptyState icon={CheckCircle2} title="Nothing here" />}
          columns={[
            { key: 'createdAt', header: 'Requested', render: (r) => formatDateTime(r.createdAt) },
            {
              key: 'summary',
              header: 'Change',
              render: (r) => (
                <span>
                  <span className="font-medium text-ink">{r.summary}</span>
                  <span className="block text-xs text-ink-subtle">
                    {APPROVAL_TYPES[r.type]} · by {r.requestedBy.name} · “{r.reason}”
                  </span>
                  {r.error && <span className="block text-xs text-danger">{r.error}</span>}
                  {r.decisionNote && r.status !== 'PENDING' && (
                    <span className="block text-xs text-ink-subtle">
                      {r.decidedBy?.name}: “{r.decisionNote}”
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => <Badge tone={APPROVAL_STATUS[r.status].tone}>{APPROVAL_STATUS[r.status].label}</Badge>,
            },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (r) =>
                r.status === 'PENDING' &&
                (r.requestedBy.id === session?.user?.id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={cancel.isPending && cancel.variables === r.id}
                    onClick={() => cancel.mutate(r.id)}
                  >
                    Withdraw
                  </Button>
                ) : (
                  canDecide && (
                    <Button size="sm" onClick={() => setDeciding({ ...r, note: '' })}>
                      Review
                    </Button>
                  )
                )),
            },
          ]}
        />
      </Card>
      {deciding && (
        <Modal
          open
          onClose={() => setDeciding(null)}
          title="Review request"
          footer={
            <>
              <Button
                variant="ghost"
                disabled={deciding.note.trim().length < 3}
                loading={decide.isPending && decide.variables?.approve === false}
                onClick={() => decide.mutate({ id: deciding.id, approve: false, note: deciding.note })}
              >
                Reject
              </Button>
              <Button
                disabled={deciding.note.trim().length < 3}
                loading={decide.isPending && decide.variables?.approve === true}
                onClick={() => decide.mutate({ id: deciding.id, approve: true, note: deciding.note })}
              >
                Approve and apply
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            {decide.error && <Alert tone="danger">{decide.error.message}</Alert>}
            <p className="font-medium text-ink">{deciding.summary}</p>
            <p className="text-ink-muted">
              Requested by {deciding.requestedBy.name} on {formatDateTime(deciding.createdAt)}: “{deciding.reason}”
            </p>
            <pre className="overflow-x-auto rounded-lg bg-surface-muted p-3 text-xs">{JSON.stringify(deciding.payload, null, 2)}</pre>
            <Field label="Your note (recorded in the audit log)">
              {(p) => (
                <Textarea rows={3} value={deciding.note} onChange={(e) => setDeciding((d) => ({ ...d, note: e.target.value }))} {...p} />
              )}
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function ApprovalsPage() {
  usePageMeta({ title: 'Approvals · Mynx admin' });
  const { data: session } = useSession();
  const canDecide = hasPermission(session, 'approvals:decide');
  const [tab, setTab] = useState('pending');
  return (
    <>
      <PageHeader
        title="Approvals"
        description="High-risk changes need a second person. Nothing is applied until someone other than the requester approves it."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'pending', label: 'Pending', content: <RequestList query="status=PENDING" canDecide={canDecide} /> },
          { value: 'mine', label: 'My requests', content: <RequestList query="status=ALL&mine=true" canDecide={false} /> },
          { value: 'history', label: 'History', content: <RequestList query="status=ALL" canDecide={canDecide} /> },
        ]}
      />
    </>
  );
}
