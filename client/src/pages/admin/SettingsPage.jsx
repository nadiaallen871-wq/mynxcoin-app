import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

// Pesewas to "12.50" by string slicing (no floating point on money).
const minorToDecimal = (n) => {
  const s = String(n).padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
};

function ValueText({ s, value }) {
  const money = useMoney();
  if (s.type === 'boolean') return value ? 'On' : 'Off';
  if (s.type === 'money') return money({ amountMinor: String(value), currency: 'GHS' });
  if (s.type === 'string') return value ? `“${value}”` : <span className="text-ink-subtle">Empty</span>;
  return String(value);
}

function ProposeModal({ s, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [value, setValue] = useState(
    s.type === 'money' ? minorToDecimal(s.value) : s.type === 'boolean' ? String(s.value) : String(s.value ?? ''),
  );
  const [reason, setReason] = useState('');
  const parsed = () => {
    if (s.type === 'boolean') return value === 'true';
    if (s.type === 'integer') return Number.parseInt(value, 10);
    // Money is entered in cedis and sent as whole pesewas; digits are parsed without floating point.
    if (s.type === 'money') {
      const [w, f = ''] = value.trim().split('.');
      return Number.parseInt(`${w}${f.padEnd(2, '0').slice(0, 2)}`, 10);
    }
    return value;
  };
  const propose = useMutation({
    mutationFn: () => api.post(`/admin/settings/${s.key}/proposals`, { value: parsed(), reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Change requested', 'It applies once a second administrator approves it.');
      onClose();
    },
  });
  const valueError = propose.error?.details?.find((d) => d.path === 'value')?.message;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Change ${s.key}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={propose.isPending} disabled={reason.trim().length < 10} onClick={() => propose.mutate()}>
            Request change
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">{s.description}</p>
        {propose.error && !valueError && <Alert tone="danger">{propose.error.message}</Alert>}
        <Field
          label={s.type === 'money' ? 'New value (GHS)' : 'New value'}
          error={valueError}
          hint={s.min !== null && s.type !== 'money' ? `Between ${s.min} and ${s.max}` : undefined}
        >
          {(p) =>
            s.type === 'boolean' ? (
              <Select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                options={[
                  { value: 'true', label: 'On' },
                  { value: 'false', label: 'Off' },
                ]}
                {...p}
              />
            ) : s.type === 'string' ? (
              <Textarea rows={3} maxLength={s.maxLength ?? 500} value={value} onChange={(e) => setValue(e.target.value)} {...p} />
            ) : (
              <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} {...p} />
            )
          }
        </Field>
        <Field label="Reason (shown to the approver)">
          {(p) => <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} {...p} />}
        </Field>
      </div>
    </Modal>
  );
}

export default function SettingsPage() {
  usePageMeta({ title: 'Settings · Mynx admin' });
  const { data: session } = useSession();
  const canPropose = hasPermission(session, 'settings:manage');
  const [editing, setEditing] = useState(null);
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get('/admin/settings').then((r) => r.data) });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const groups = q.data.reduce((acc, s) => ({ ...acc, [s.group]: [...(acc[s.group] ?? []), s] }), {});

  return (
    <>
      <PageHeader
        title="System settings"
        description="Every change needs a second administrator’s approval and is recorded in the audit log."
      />
      <Alert tone="info" className="mb-6">
        Pending changes are listed on the{' '}
        <Link to="/admin/approvals" className="font-medium underline">
          Approvals
        </Link>{' '}
        page. Unchanged settings use the deployment defaults.
      </Alert>
      <div className="space-y-6">
        {Object.entries(groups).map(([group, items]) => (
          <Card key={group}>
            <CardHeader title={group} />
            <ul className="divide-y divide-border">
              {items.map((s) => (
                <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-ink-subtle">{s.key}</p>
                    <p className="text-sm text-ink">{s.description}</p>
                    {s.updatedAt && <p className="text-xs text-ink-subtle">Last changed {formatDateTime(s.updatedAt)}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular text-sm font-semibold text-ink">
                      <ValueText s={s} value={s.value} />
                    </span>
                    {s.pending && <Badge tone="warning">Change pending</Badge>}
                    {!s.editable ? (
                      <Lock className="size-4 text-ink-subtle" aria-label="Not editable from the console" />
                    ) : (
                      canPropose &&
                      !s.pending && (
                        <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                          Change
                        </Button>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {editing && <ProposeModal s={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
