import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Landmark, Plus } from 'lucide-react';
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
  Select,
  Skeleton,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const INCOME = { INTEREST: 'Interest', CAPITAL_GAIN: 'Capital gain', REFERRAL_REWARD: 'Referral reward' };
const EMPTY = {
  jurisdiction: 'GH',
  incomeType: 'INTEREST',
  investorType: '',
  ratePercent: '',
  effectiveFrom: '',
  effectiveTo: '',
  description: '',
  legalReference: '',
  reason: '',
};

export default function TaxRulesPage() {
  usePageMeta({ title: 'Tax rules · Mynx admin' });
  const toast = useToast();
  const { data: session } = useSession();
  const canManage = hasPermission(session, 'tax:rules:manage');
  const [form, setForm] = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const list = useQuery({ queryKey: ['admin', 'tax-rules'], queryFn: () => api.get('/admin/tax/rules').then((r) => r.data) });
  const propose = useMutation({
    mutationFn: (f) =>
      api.post('/admin/tax/rules', {
        ...f,
        investorType: f.investorType || null,
        ...(f.effectiveTo ? {} : { effectiveTo: undefined }),
      }),
    onSuccess: () => {
      toast.success('Sent for approval', 'The rule applies once a second person approves it.');
      setForm(null);
    },
  });
  const deactivate = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/admin/tax/rules/${id}/deactivate`, { reason }),
    onSuccess: () => {
      toast.success('Sent for approval');
      setDeactivating(null);
    },
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const err = (path) => propose.error?.details?.find((d) => d.path === path)?.message;

  return (
    <>
      <PageHeader
        title="Tax rules"
        description="Rules used to estimate tax on investor tax statements. No rule is built in."
        actions={
          canManage && (
            <Button onClick={() => setForm(EMPTY)}>
              <Plus className="size-4" aria-hidden="true" /> Propose a rule
            </Button>
          )
        }
      />
      <Alert tone="warning" className="mb-6">
        Enter rules only from a qualified tax adviser’s guidance, with the legal reference. Statements show estimates; nothing is withheld
        from investors. Withholding would need a legal basis and remittance arrangements with the tax authority.
      </Alert>
      {list.isPending && <Skeleton className="h-40" />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Tax rules"
            rows={list.data}
            empty={
              <EmptyState icon={Landmark} title="No tax rules" description="Tax statements list income only until rules are approved." />
            }
            columns={[
              { key: 'jurisdiction', header: 'Jurisdiction', render: (r) => r.jurisdiction },
              {
                key: 'type',
                header: 'Income',
                render: (r) => (
                  <span>
                    {INCOME[r.incomeType]}
                    <span className="block text-xs text-ink-subtle">
                      {r.investorType ? `${r.investorType.toLowerCase()} investors` : 'All investors'}
                    </span>
                  </span>
                ),
              },
              { key: 'rate', header: 'Rate', align: 'right', render: (r) => `${r.ratePercent}%` },
              { key: 'dates', header: 'In force', render: (r) => `${r.effectiveFrom} → ${r.effectiveTo ?? 'open'}` },
              {
                key: 'ref',
                header: 'Basis',
                render: (r) => (
                  <span className="text-xs">
                    {r.description}
                    <span className="block text-ink-subtle">{r.legalReference}</span>
                  </span>
                ),
              },
              {
                key: 'active',
                header: 'Status',
                render: (r) => <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</Badge>,
              },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                render: (r) =>
                  canManage &&
                  r.active && (
                    <Button size="sm" variant="ghost" onClick={() => setDeactivating({ id: r.id, reason: '' })}>
                      Deactivate
                    </Button>
                  ),
              },
            ]}
          />
        </Card>
      )}
      {form && (
        <Modal
          open
          size="lg"
          onClose={() => setForm(null)}
          title="Propose a tax rule"
          footer={
            <>
              <Button variant="secondary" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button loading={propose.isPending} onClick={() => propose.mutate(form)}>
                Request approval
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {propose.error && !propose.error.details && <Alert tone="danger">{propose.error.message}</Alert>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Jurisdiction (country code)" error={err('jurisdiction')}>
                {(p) => (
                  <Input
                    maxLength={2}
                    value={form.jurisdiction}
                    onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value.toUpperCase() }))}
                    {...p}
                  />
                )}
              </Field>
              <Field label="Income type">
                {(p) => (
                  <Select
                    value={form.incomeType}
                    onChange={set('incomeType')}
                    options={Object.entries(INCOME).map(([value, label]) => ({ value, label }))}
                    {...p}
                  />
                )}
              </Field>
              <Field label="Investors">
                {(p) => (
                  <Select
                    value={form.investorType}
                    onChange={set('investorType')}
                    options={[
                      { value: '', label: 'All' },
                      { value: 'INDIVIDUAL', label: 'Individuals' },
                      { value: 'INSTITUTIONAL', label: 'Institutions' },
                    ]}
                    {...p}
                  />
                )}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Rate (%)" error={err('ratePercent')}>
                {(p) => <Input inputMode="decimal" value={form.ratePercent} onChange={set('ratePercent')} {...p} />}
              </Field>
              <Field label="In force from" error={err('effectiveFrom')}>
                {(p) => <Input type="date" value={form.effectiveFrom} onChange={set('effectiveFrom')} {...p} />}
              </Field>
              <Field label="Until (optional)" error={err('effectiveTo')}>
                {(p) => <Input type="date" value={form.effectiveTo} onChange={set('effectiveTo')} {...p} />}
              </Field>
            </div>
            <Field label="Description" error={err('description')}>
              {(p) => <Input value={form.description} onChange={set('description')} {...p} />}
            </Field>
            <Field label="Legal basis or adviser reference" error={err('legalReference')}>
              {(p) => <Input value={form.legalReference} onChange={set('legalReference')} {...p} />}
            </Field>
            <Field label="Reason (shown to the approver)" error={err('reason')}>
              {(p) => <Textarea rows={2} value={form.reason} onChange={set('reason')} {...p} />}
            </Field>
          </div>
        </Modal>
      )}
      {deactivating && (
        <Modal
          open
          onClose={() => setDeactivating(null)}
          title="Deactivate tax rule"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeactivating(null)}>
                Cancel
              </Button>
              <Button
                loading={deactivate.isPending}
                disabled={deactivating.reason.trim().length < 10}
                onClick={() => deactivate.mutate(deactivating)}
              >
                Request approval
              </Button>
            </>
          }
        >
          {deactivate.error && (
            <Alert tone="danger" className="mb-3">
              {deactivate.error.message}
            </Alert>
          )}
          <Field label="Reason">
            {(p) => (
              <Textarea
                rows={3}
                value={deactivating.reason}
                onChange={(e) => setDeactivating((d) => ({ ...d, reason: e.target.value }))}
                {...p}
              />
            )}
          </Field>
        </Modal>
      )}
    </>
  );
}
