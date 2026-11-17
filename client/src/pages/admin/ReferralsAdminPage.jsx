import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Plus } from 'lucide-react';
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
  Tabs,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { REFERRAL_STATUS } from '../../features/portfolio/labels.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const FLAGS = { SHARED_NETWORK: 'Same network as referrer', REFERRER_NOT_VERIFIED: 'Referrer not verified' };

function Campaigns() {
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(null);
  const list = useQuery({
    queryKey: ['admin', 'referrals', 'campaigns'],
    queryFn: () => api.get('/admin/referrals/campaigns').then((r) => r.data),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'referrals', 'campaigns'] });
  const create = useMutation({
    mutationFn: (f) =>
      api.post('/admin/referrals/campaigns', {
        name: f.name,
        ...(f.description ? { description: f.description } : {}),
        reward: f.reward,
        minInvestment: f.minInvestment,
        ...(f.cap ? { maxRewardsPerReferrer: Number(f.cap) } : {}),
        startsAt: new Date(f.startsAt).toISOString(),
        ...(f.endsAt ? { endsAt: new Date(f.endsAt).toISOString() } : {}),
      }),
    onSuccess: () => {
      refresh();
      setForm(null);
      toast.success('Campaign created', 'A different administrator must review and activate it.');
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }) => api.post(`/admin/referrals/campaigns/${id}/${active ? 'activate' : 'deactivate'}`),
    onSuccess: refresh,
    onError: (e) => toast.error('Could not change the campaign', e.message),
  });
  if (list.isPending) return <Skeleton className="h-40" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <Alert tone="info" className="mb-4">
        Referral rewards are a financial promotion. Have compliance review the terms before a second administrator activates a campaign.
      </Alert>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() =>
            setForm({
              name: '',
              description: '',
              reward: '',
              minInvestment: '',
              cap: '',
              startsAt: new Date().toISOString().slice(0, 16),
              endsAt: '',
            })
          }
        >
          <Plus className="size-4" aria-hidden="true" /> New campaign
        </Button>
      </div>
      <Card>
        <DataTable
          caption="Referral campaigns"
          rows={list.data}
          empty={<EmptyState icon={Gift} title="No campaigns" />}
          columns={[
            { key: 'name', header: 'Campaign', render: (c) => <span className="font-medium text-ink">{c.name}</span> },
            { key: 'reward', header: 'Reward', align: 'right', render: (c) => money(c.reward) },
            { key: 'min', header: 'Friend invests at least', align: 'right', render: (c) => money(c.minInvestment) },
            {
              key: 'window',
              header: 'Runs',
              render: (c) => (
                <span className="text-xs">
                  {formatDateTime(c.startsAt)} → {c.endsAt ? formatDateTime(c.endsAt) : 'no end'}
                </span>
              ),
            },
            { key: 'usage', header: 'Referrals / paid', align: 'right', render: (c) => `${c.referrals} / ${c.rewardsPaid}` },
            {
              key: 'active',
              header: 'Status',
              render: (c) => (
                <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : c.approvedAt ? 'Paused' : 'Awaiting approval'}</Badge>
              ),
            },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (c) => (
                <Button
                  size="sm"
                  variant={c.active ? 'ghost' : 'primary'}
                  loading={toggle.isPending && toggle.variables?.id === c.id}
                  onClick={() => toggle.mutate({ id: c.id, active: !c.active })}
                >
                  {c.active ? 'Pause' : 'Approve and activate'}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      {form && (
        <Modal
          open
          onClose={() => setForm(null)}
          title="New referral campaign"
          footer={
            <>
              <Button variant="secondary" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button loading={create.isPending} onClick={() => create.mutate(form)}>
                Create (inactive)
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {create.error && <Alert tone="danger">{create.error.details?.[0]?.message ?? create.error.message}</Alert>}
            <Field label="Name">{(p) => <Input value={form.name} onChange={set('name')} {...p} />}</Field>
            <Field label="Description (optional)">
              {(p) => <Textarea rows={2} value={form.description} onChange={set('description')} {...p} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Reward (GHS)">{(p) => <Input inputMode="decimal" value={form.reward} onChange={set('reward')} {...p} />}</Field>
              <Field label="Minimum investment (GHS)">
                {(p) => <Input inputMode="decimal" value={form.minInvestment} onChange={set('minInvestment')} {...p} />}
              </Field>
              <Field label="Rewards per person">
                {(p) => <Input type="number" min={1} value={form.cap} onChange={set('cap')} placeholder="No limit" {...p} />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts">{(p) => <Input type="datetime-local" value={form.startsAt} onChange={set('startsAt')} {...p} />}</Field>
              <Field label="Ends (optional)">
                {(p) => <Input type="datetime-local" value={form.endsAt} onChange={set('endsAt')} {...p} />}
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Review() {
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('QUALIFIED');
  const [deciding, setDeciding] = useState(null);
  const list = useQuery({
    queryKey: ['admin', 'referrals', 'list', status],
    queryFn: () => api.get(`/admin/referrals?pageSize=50${status ? `&status=${status}` : ''}`),
  });
  const decide = useMutation({
    mutationFn: ({ id, approve, note }) => api.post(`/admin/referrals/${id}/decide`, { approve, note }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin', 'referrals'] });
      toast.success(res.data.status === 'REWARDED' ? 'Reward paid' : 'Referral rejected');
      setDeciding(null);
    },
  });
  return (
    <>
      <div className="mb-4 max-w-xs">
        <Field label="Status">
          {(p) => (
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: '', label: 'All' },
                ...Object.entries(REFERRAL_STATUS).map(([value, s]) => ({
                  value,
                  label: value === 'QUALIFIED' ? 'Held for review' : s.label,
                })),
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
          <DataTable
            caption="Referrals"
            rows={list.data.data}
            empty={<EmptyState icon={Gift} title="Nothing to review" />}
            columns={[
              {
                key: 'referrer',
                header: 'Referrer',
                render: (r) => (
                  <span>
                    {r.referrer.name}
                    <span className="block text-xs text-ink-subtle">{r.referrer.email}</span>
                  </span>
                ),
              },
              {
                key: 'referred',
                header: 'Friend',
                render: (r) => (
                  <span>
                    {r.referred.name}
                    <span className="block text-xs text-ink-subtle">{r.referred.email}</span>
                  </span>
                ),
              },
              { key: 'campaign', header: 'Campaign', render: (r) => r.campaign?.name ?? '—' },
              {
                key: 'flags',
                header: 'Signals',
                render: (r) =>
                  r.flags.length ? (
                    <span className="flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <Badge key={f} tone="warning">
                          {FLAGS[f] ?? f}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-subtle">None</span>
                  ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <Badge tone={REFERRAL_STATUS[r.status].tone}>
                    {r.status === 'QUALIFIED' ? 'Held for review' : REFERRAL_STATUS[r.status].label}
                  </Badge>
                ),
              },
              { key: 'reward', header: 'Reward', align: 'right', render: (r) => (r.reward ? money(r.reward) : '—') },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                render: (r) =>
                  r.status === 'QUALIFIED' && (
                    <Button size="sm" onClick={() => setDeciding({ ...r, note: '' })}>
                      Review
                    </Button>
                  ),
              },
            ]}
          />
        </Card>
      )}
      {deciding && (
        <Modal
          open
          onClose={() => setDeciding(null)}
          title="Review referral"
          footer={
            <>
              <Button
                variant="ghost"
                loading={decide.isPending && decide.variables?.approve === false}
                disabled={deciding.note.trim().length < 5}
                onClick={() => decide.mutate({ id: deciding.id, approve: false, note: deciding.note })}
              >
                Reject
              </Button>
              <Button
                loading={decide.isPending && decide.variables?.approve === true}
                disabled={deciding.note.trim().length < 5}
                onClick={() => decide.mutate({ id: deciding.id, approve: true, note: deciding.note })}
              >
                Approve and pay
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-ink-muted">
            {deciding.referrer.name} referred {deciding.referred.name}. Signals:{' '}
            {deciding.flags.map((f) => FLAGS[f] ?? f).join(', ') || 'none'}. Paying credits the referrer’s wallet from the referral rewards
            expense account.
          </p>
          {decide.error && (
            <Alert tone="danger" className="mb-3">
              {decide.error.message}
            </Alert>
          )}
          <Field label="Decision note (recorded in the audit log)">
            {(p) => (
              <Textarea rows={3} value={deciding.note} onChange={(e) => setDeciding((d) => ({ ...d, note: e.target.value }))} {...p} />
            )}
          </Field>
        </Modal>
      )}
    </>
  );
}

export default function ReferralsAdminPage() {
  usePageMeta({ title: 'Referrals · Mynx admin' });
  const [tab, setTab] = useState('review');
  return (
    <>
      <PageHeader
        title="Referrals"
        description="Reward campaigns and referrals held for review. Flagged referrals are never paid automatically."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'review', label: 'Review', content: <Review /> },
          { value: 'campaigns', label: 'Campaigns', content: <Campaigns /> },
        ]}
      />
    </>
  );
}
