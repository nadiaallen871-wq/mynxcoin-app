import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Drawer,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const groupOf = (key) => key.split(':')[0];

function RoleEditor({ open, role, permissions, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = !role;
  const [key, setKey] = useState('');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState(new Set(role?.permissions ?? []));

  const staffPermissions = permissions.filter((p) => p.staff);
  const groups = useMemo(() => {
    const map = new Map();
    for (const p of staffPermissions) map.set(groupOf(p.key), [...(map.get(groupOf(p.key)) ?? []), p]);
    return [...map.entries()];
  }, [staffPermissions]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description: description || undefined, permissions: [...selected] };
      return isNew ? api.post('/admin/roles', { key, ...body }) : api.patch(`/admin/roles/${role.key}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
      toast.success(isNew ? 'Role created' : 'Role updated');
      onClose();
    },
  });

  const toggle = (k) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? 'New custom role' : `Edit ${role.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!name.trim() || selected.size === 0 || (isNew && !/^[A-Z][A-Z0-9_]{2,63}$/.test(key))}
            onClick={() => save.mutate()}
          >
            {isNew ? 'Create role' : 'Save role'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert tone="danger">{save.error.details?.[0]?.message ?? save.error.message}</Alert>}
        {isNew && (
          <Field label="Key" hint="UPPER_SNAKE_CASE, e.g. REPORT_VIEWER. Cannot be changed later." required>
            {(p) => (
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                className="font-mono"
                {...p}
              />
            )}
          </Field>
        )}
        <Field label="Name" required>
          {(p) => <Input value={name} onChange={(e) => setName(e.target.value)} {...p} />}
        </Field>
        <Field label="Description">{(p) => <Textarea value={description} onChange={(e) => setDescription(e.target.value)} {...p} />}</Field>
        <fieldset>
          <legend className="text-sm font-medium text-ink">Permissions</legend>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Conflicting duties (e.g. proposing and approving the same adjustment) are rejected.
          </p>
          <div className="mt-3 space-y-4">
            {groups.map(([group, perms]) => (
              <div key={group}>
                <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">{group}</p>
                <div className="mt-1 space-y-1">
                  {perms.map((p) => (
                    <label key={p.key} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-brand-600"
                        checked={selected.has(p.key)}
                        onChange={() => toggle(p.key)}
                      />
                      <span>
                        <span className="block text-ink">{p.description}</span>
                        <span className="block font-mono text-xs text-ink-subtle">{p.key}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      </div>
    </Drawer>
  );
}

export default function RolesPage() {
  usePageMeta({ title: 'Roles · Mynx Admin' });
  const { data: session } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = hasPermission(session, 'roles:manage');
  const [editing, setEditing] = useState(null); // null | 'new' | role
  const [deleting, setDeleting] = useState(null);
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => api.get('/admin/roles').then((r) => r.data) });
  const permissions = useQuery({ queryKey: ['admin', 'permissions'], queryFn: () => api.get('/admin/permissions').then((r) => r.data) });
  const describe = (key) => permissions.data?.find((p) => p.key === key)?.description ?? key;

  const remove = useMutation({
    mutationFn: (key) => api.delete(`/admin/roles/${key}`),
    onSuccess: () => {
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
      toast.success('Role deleted');
    },
    onError: (err) => {
      setDeleting(null);
      toast.error('Could not delete role', err.message);
    },
  });

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="System roles are defined in code and reviewed with each release. Custom roles can be added for staff."
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')} disabled={!permissions.data}>
              <Plus className="size-4" aria-hidden="true" /> New role
            </Button>
          )
        }
      />
      {roles.isPending && <Skeleton className="h-64" />}
      {roles.isError && <ErrorState error={roles.error} onRetry={roles.refetch} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.data?.map((role) => (
          <Card key={role.key} className="flex flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 font-semibold text-ink">
                  {role.name}
                  {role.isSystem && <Lock className="size-3.5 text-ink-subtle" aria-label="System role" />}
                </h2>
                <p className="mt-0.5 font-mono text-xs text-ink-subtle">{role.key}</p>
                {role.description && <p className="mt-1 text-sm text-ink-muted">{role.description}</p>}
              </div>
              <Badge tone="info" dot={false}>
                {role.userCount} {role.userCount === 1 ? 'user' : 'users'}
              </Badge>
            </div>
            <details className="group flex-1 px-5 py-3">
              <summary className="cursor-pointer text-sm font-medium text-brand-700">{role.permissions.length} permissions</summary>
              <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                {role.permissions.map((p) => (
                  <li key={p}>{describe(p)}</li>
                ))}
              </ul>
            </details>
            {canManage && !role.isSystem && (
              <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(role)}>
                  Delete
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(role)}>
                  Edit
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      {editing && permissions.data && (
        <RoleEditor
          key={editing === 'new' ? 'new' : editing.key}
          open
          role={editing === 'new' ? null : editing}
          permissions={permissions.data}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting.key)}
        loading={remove.isPending}
        title="Delete role?"
        confirmLabel="Delete role"
        tone="danger"
      >
        “{deleting?.name}” will be permanently removed. Roles still assigned to users cannot be deleted.
      </ConfirmDialog>
    </>
  );
}
