import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, Users } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api, applyServerErrors } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

export const STATUS_TONE = { ACTIVE: 'success', PENDING_VERIFICATION: 'warning', SUSPENDED: 'danger', LOCKED: 'danger', CLOSED: 'neutral' };
export const STATUS_LABEL = {
  ACTIVE: 'Active',
  PENDING_VERIFICATION: 'Pending',
  SUSPENDED: 'Suspended',
  LOCKED: 'Locked',
  CLOSED: 'Closed',
};
const TYPE_LABEL = { INDIVIDUAL: 'Individual', INSTITUTIONAL: 'Institutional', STAFF: 'Staff' };

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const inviteSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  firstName: z.string().trim().min(1, 'Required'),
  lastName: z.string().trim().min(1, 'Required'),
  roleKey: z.string().min(1, 'Choose a role'),
});

function InviteStaffModal({ open, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => api.get('/admin/roles').then((r) => r.data), enabled: open });
  const form = useForm({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', firstName: '', lastName: '', roleKey: '' } });
  const invite = useMutation({
    mutationFn: ({ roleKey, ...rest }) => api.post('/admin/users', { ...rest, roleKeys: [roleKey] }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('Invitation sent', `${res.data.email} will receive a link to set a password.`);
      form.reset();
      onClose();
    },
    onError: (err) => applyServerErrors(err, form.setError),
  });
  const staffRoles = (roles.data ?? []).filter((r) => !['INDIVIDUAL_INVESTOR', 'INSTITUTIONAL_INVESTOR'].includes(r.key));
  const e = form.formState.errors;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a staff member"
      description="They receive a single-use link to choose a password, then must enable two-factor authentication."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={invite.isPending} onClick={form.handleSubmit((v) => invite.mutate(v))}>
            Send invitation
          </Button>
        </>
      }
    >
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => invite.mutate(v))}>
        {invite.error && !invite.error.details && <Alert tone="danger">{invite.error.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={e.firstName?.message} required>
            {(p) => <Input {...p} {...form.register('firstName')} />}
          </Field>
          <Field label="Last name" error={e.lastName?.message} required>
            {(p) => <Input {...p} {...form.register('lastName')} />}
          </Field>
        </div>
        <Field label="Work email" error={e.email?.message} required>
          {(p) => <Input type="email" {...p} {...form.register('email')} />}
        </Field>
        <Field label="Role" error={e.roleKey?.message} hint="More roles can be added from the user’s page." required>
          {(p) => (
            <Select
              placeholder="Select a role…"
              options={staffRoles.map((r) => ({ value: r.key, label: r.name }))}
              {...p}
              {...form.register('roleKey')}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  usePageMeta({ title: 'Users · Mynx Admin' });
  const { data: session } = useSession();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const q = useDebounced(search.trim());
  const pageSize = 20;

  useEffect(() => setPage(1), [q, status, type]);

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    ...(q ? { search: q } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  });
  const users = useQuery({
    queryKey: ['admin', 'users', params.toString()],
    queryFn: ({ signal }) => api.get(`/admin/users?${params}`, { signal }),
    placeholderData: keepPreviousData,
  });

  const canInvite = hasPermission(session, 'users:manage', 'roles:manage');

  return (
    <>
      <PageHeader
        title="Users"
        description="Investors and staff accounts."
        actions={
          canInvite && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus className="size-4" aria-hidden="true" /> Invite staff
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
            <Input
              aria-label="Search users"
              placeholder="Search name, email or organisation"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <Select
            aria-label="Filter by type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="All types"
            options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </div>
        {users.isPending && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        )}
        {users.isError && <ErrorState error={users.error} onRetry={users.refetch} />}
        {users.data && (
          <>
            <DataTable
              caption="Users"
              rows={users.data.data}
              empty={<EmptyState icon={Users} title="No users found" description="Try a different search or filter." />}
              columns={[
                {
                  key: 'name',
                  header: 'User',
                  render: (u) => (
                    <Link to={`/admin/users/${u.id}`} className="group block">
                      <span className="block font-medium text-ink group-hover:text-brand-700 group-hover:underline">
                        {u.organizationName ?? ([u.firstName, u.lastName].filter(Boolean).join(' ') || '—')}
                      </span>
                      <span className="block text-xs text-ink-subtle">{u.email}</span>
                    </Link>
                  ),
                },
                { key: 'type', header: 'Type', render: (u) => TYPE_LABEL[u.type] },
                { key: 'status', header: 'Status', render: (u) => <Badge tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Badge> },
                {
                  key: 'roles',
                  header: 'Roles',
                  render: (u) => <span className="text-xs text-ink-muted">{u.roles.join(', ') || '—'}</span>,
                },
                { key: 'mfa', header: '2FA', render: (u) => (u.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>) },
                { key: 'lastLoginAt', header: 'Last sign-in', render: (u) => formatDateTime(u.lastLoginAt) },
              ]}
            />
            <Pagination page={page} pageSize={pageSize} total={users.data.meta.total} onPageChange={setPage} />
          </>
        )}
      </Card>
      {canInvite && <InviteStaffModal open={inviting} onClose={() => setInviting(false)} />}
    </>
  );
}
