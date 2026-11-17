import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from '../../components/ui/index.js';
import { RiskScoreCard } from '../../features/admin/RiskScoreCard.jsx';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { STATUS_LABEL, STATUS_TONE } from './UsersPage.jsx';
import { UserWalletCard } from '../../features/wallet/UserWalletCard.jsx';

const INVESTOR_ROLES = ['INDIVIDUAL_INVESTOR', 'INSTITUTIONAL_INVESTOR'];

export default function UserDetailPage() {
  const { id } = useParams();
  const { data: session } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [roleToAdd, setRoleToAdd] = useState('');
  const [grantReason, setGrantReason] = useState('');
  // Granting these roles creates an approval request instead of applying immediately (server-enforced).
  const needsApproval = ['SUPER_ADMIN', 'ADMIN'].includes(roleToAdd);
  const [roleToRemove, setRoleToRemove] = useState(null);
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  const user = useQuery({ queryKey: ['admin', 'users', id], queryFn: () => api.get(`/admin/users/${id}`).then((r) => r.data) });
  const canManageRoles = hasPermission(session, 'roles:manage');
  const roles = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
    enabled: canManageRoles,
  });
  usePageMeta({ title: `${user.data?.email ?? 'User'} · Mynx Admin` });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  const onError = (err) => toast.error('Action failed', err.message);

  const addRole = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/roles`, { roleKey: roleToAdd, ...(needsApproval ? { reason: grantReason } : {}) }),
    onSuccess: (res) => {
      setRoleToAdd('');
      setGrantReason('');
      invalidate();
      if (res.data?.pendingApproval) toast.success('Sent for approval', 'A second administrator must approve this role before it applies.');
      else toast.success('Role assigned');
    },
    onError,
  });
  const removeRole = useMutation({
    mutationFn: (key) => api.delete(`/admin/users/${id}/roles/${key}`),
    onSuccess: () => {
      setRoleToRemove(null);
      invalidate();
      toast.success('Role removed');
    },
    onError,
  });
  const suspend = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/suspend`, { reason }),
    onSuccess: () => {
      setSuspending(false);
      setReason('');
      invalidate();
      toast.success('User suspended and signed out');
    },
  });
  const reactivate = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/reactivate`),
    onSuccess: () => {
      invalidate();
      toast.success('User reactivated');
    },
    onError,
  });
  const revokeSessions = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/sessions/revoke`),
    onSuccess: (res) => {
      setRevoking(false);
      invalidate();
      toast.success(`Signed out ${res.data.revoked} session${res.data.revoked === 1 ? '' : 's'}`);
    },
    onError,
  });

  if (user.isPending) return <Skeleton className="h-64" />;
  if (user.isError) return <ErrorState error={user.error} onRetry={user.refetch} />;

  const u = user.data;
  const isSelf = u.id === session?.user.id;
  const name = u.organizationName ?? ([u.firstName, u.lastName].filter(Boolean).join(' ') || u.email);
  const assignable = (roles.data ?? []).filter((r) => !u.roles.includes(r.key) && INVESTOR_ROLES.includes(r.key) === (u.type !== 'STAFF'));
  const roleName = (key) => roles.data?.find((r) => r.key === key)?.name ?? key;

  return (
    <>
      <Link to="/admin/users" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" /> All users
      </Link>
      <PageHeader title={name} description={u.email} actions={<Badge tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Badge>} />
      {isSelf && (
        <Alert tone="info" className="mb-6">
          This is your account. You can’t change your own roles or status, which keeps duties separate.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Roles" description="Permissions come from roles. Changes apply immediately." />
            <CardBody className="space-y-4">
              <ul className="flex flex-wrap gap-2">
                {u.roles.length === 0 && <li className="text-sm text-ink-muted">No roles assigned.</li>}
                {u.roles.map((key) => (
                  <li key={key} className="inline-flex items-center gap-1 rounded-full bg-surface-muted py-1 pr-1 pl-3 text-sm text-ink">
                    {roleName(key)}
                    {canManageRoles && !isSelf && (
                      <button
                        type="button"
                        className="rounded-full p-1 text-ink-subtle hover:bg-border hover:text-danger"
                        aria-label={`Remove role ${roleName(key)}`}
                        onClick={() => setRoleToRemove(key)}
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canManageRoles && !isSelf && (
                <form
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addRole.mutate();
                  }}
                >
                  <Field label="Add a role" className="flex-1">
                    {(p) => (
                      <Select
                        placeholder="Select a role…"
                        value={roleToAdd}
                        onChange={(e) => setRoleToAdd(e.target.value)}
                        options={assignable.map((r) => ({ value: r.key, label: r.name }))}
                        {...p}
                      />
                    )}
                  </Field>
                  {needsApproval && (
                    <Field label="Reason (needs a second approver)" className="flex-1">
                      {(p) => <Input value={grantReason} onChange={(e) => setGrantReason(e.target.value)} {...p} />}
                    </Field>
                  )}
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={!roleToAdd || (needsApproval && grantReason.trim().length < 10)}
                    loading={addRole.isPending}
                  >
                    {needsApproval ? 'Request' : 'Assign'}
                  </Button>
                </form>
              )}
            </CardBody>
          </Card>
          {u.type !== 'STAFF' && hasPermission(session, 'wallet:read:any') && <UserWalletCard userId={u.id} />}
          {u.type !== 'STAFF' && hasPermission(session, 'compliance:cases:read') && <RiskScoreCard userId={u.id} />}
        </div>

        <Card className="h-fit">
          <CardHeader title="Account" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              {[
                ['Type', u.type.charAt(0) + u.type.slice(1).toLowerCase()],
                ['Email confirmed', u.emailVerified ? 'Yes' : 'No'],
                ['Phone verified', u.phoneVerified ? 'Yes' : 'No'],
                ['Two-factor', u.mfaEnabled ? 'On' : 'Off'],
                ['Active sessions', u.activeSessions],
                ['Last sign-in', formatDateTime(u.lastLoginAt)],
                ['Created', formatDateTime(u.createdAt)],
                ...(u.lockedUntil && new Date(u.lockedUntil) > new Date() ? [['Locked until', formatDateTime(u.lockedUntil)]] : []),
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-ink-subtle">{label}</dt>
                  <dd className="tabular font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
          {!isSelf && (
            <div className="flex flex-col gap-2 border-t border-border p-4">
              {hasPermission(session, 'sessions:revoke:any') && (
                <Button variant="secondary" onClick={() => setRevoking(true)} disabled={!u.activeSessions}>
                  Sign out all sessions
                </Button>
              )}
              {hasPermission(session, 'users:manage') &&
                (u.status === 'SUSPENDED' ? (
                  <Button variant="secondary" onClick={() => reactivate.mutate()} loading={reactivate.isPending}>
                    Reactivate account
                  </Button>
                ) : (
                  u.status !== 'CLOSED' && (
                    <Button variant="danger" onClick={() => setSuspending(true)}>
                      Suspend account
                    </Button>
                  )
                ))}
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(roleToRemove)}
        onClose={() => setRoleToRemove(null)}
        onConfirm={() => removeRole.mutate(roleToRemove)}
        loading={removeRole.isPending}
        title="Remove role?"
        confirmLabel="Remove role"
        tone="danger"
      >
        {name} will immediately lose the permissions granted by “{roleToRemove && roleName(roleToRemove)}”.
      </ConfirmDialog>
      <ConfirmDialog
        open={revoking}
        onClose={() => setRevoking(false)}
        onConfirm={() => revokeSessions.mutate()}
        loading={revokeSessions.isPending}
        title="Sign out all sessions?"
        confirmLabel="Sign out"
      >
        {name} will be signed out on every device and must sign in again.
      </ConfirmDialog>
      <Modal
        open={suspending}
        onClose={() => setSuspending(false)}
        title="Suspend account"
        description="The user is signed out everywhere and cannot sign in until reactivated."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSuspending(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={suspend.isPending} disabled={reason.trim().length < 5} onClick={() => suspend.mutate()}>
              Suspend account
            </Button>
          </>
        }
      >
        {suspend.error && (
          <Alert tone="danger" className="mb-4">
            {suspend.error.message}
          </Alert>
        )}
        <Field label="Reason (recorded in the audit log)" hint="At least 5 characters." required>
          {(p) => <Textarea value={reason} onChange={(e) => setReason(e.target.value)} {...p} />}
        </Field>
      </Modal>
    </>
  );
}
