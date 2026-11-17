import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Gift, Users } from 'lucide-react';
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
  Skeleton,
  StatCard,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { REFERRAL_STATUS } from '../../features/portfolio/labels.js';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

export default function ReferralsPage() {
  usePageMeta({ title: 'Referrals · Mynx' });
  const money = useMoney();
  const [copied, setCopied] = useState(null);
  const q = useQuery({ queryKey: ['referrals'], queryFn: () => api.get('/referrals').then((r) => r.data) });

  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const earned = d.stats.rewards.find((r) => r.currency === 'GHS');
  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied('failed');
    }
  };

  return (
    <>
      <PageHeader
        title="Refer a friend"
        description="Share your link. Rewards are paid only for friends who verify their identity and invest."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Friends who signed up" value={String(d.stats.total)} icon={Users} />
        <StatCard label="Rewarded" value={String(d.stats.byStatus.REWARDED ?? 0)} icon={Gift} />
        <StatCard
          label="Rewards earned"
          value={money({ amountMinor: earned?.amountMinor ?? '0', currency: 'GHS' })}
          hint="Paid into your wallet"
          icon={Gift}
        />
      </div>

      <div className="mb-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Card>
          <CardHeader title="Your referral link" />
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">{d.link}</code>
              <Button variant="secondary" onClick={() => copy('link', d.link)} aria-label="Copy referral link">
                <Copy className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <p className="text-sm text-ink-muted">
              Or share your code{' '}
              <button type="button" className="font-mono font-semibold text-ink underline" onClick={() => copy('code', d.code)}>
                {d.code}
              </button>
            </p>
            <p role="status" className="text-xs text-success">
              {copied === 'link'
                ? 'Link copied'
                : copied === 'code'
                  ? 'Code copied'
                  : copied === 'failed'
                    ? 'Copy failed: select the text instead'
                    : ''}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="How rewards work" />
          <CardBody className="space-y-2 text-sm text-ink-muted">
            {d.campaign ? (
              <>
                <p>
                  <strong className="text-ink">{d.campaign.name}:</strong> you get{' '}
                  <strong className="text-ink">{money(d.campaign.reward)}</strong> when a friend you referred verifies their identity and
                  makes a confirmed investment of at least {money(d.campaign.minInvestment)}.
                  {d.campaign.maxRewardsPerReferrer ? ` Up to ${d.campaign.maxRewardsPerReferrer} rewards per person.` : ''}
                  {d.campaign.endsAt ? ` Sign-ups until ${formatDateTime(d.campaign.endsAt)}.` : ''}
                </p>
                <p>
                  Your friend must sign up with your link or code. You need to be verified too. Some referrals are checked by our team
                  before payment.
                </p>
              </>
            ) : (
              <p>There is no referral reward running right now. You can still share your link, and friends who sign up are recorded.</p>
            )}
            <p className="text-xs">Only refer people you know. Do not promise returns: investments carry risk and you could lose money.</p>
          </CardBody>
        </Card>
      </div>

      <Alert tone="warning" className="mb-6">
        Sandbox: rewards are paid in simulated money.
      </Alert>

      <Card>
        <CardHeader title="Your referrals" />
        <DataTable
          caption="Referral history"
          rows={d.referrals}
          empty={<EmptyState icon={Users} title="No referrals yet" description="Friends who sign up with your link appear here." />}
          columns={[
            { key: 'friend', header: 'Friend', render: (r) => r.friend },
            { key: 'createdAt', header: 'Signed up', render: (r) => formatDateTime(r.createdAt) },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <span>
                  <Badge tone={REFERRAL_STATUS[r.status].tone}>{REFERRAL_STATUS[r.status].label}</Badge>
                  {r.note && <span className="mt-1 block text-xs text-ink-subtle">{r.note}</span>}
                </span>
              ),
            },
            { key: 'reward', header: 'Reward', align: 'right', render: (r) => (r.reward ? money(r.reward) : '—') },
          ]}
        />
      </Card>
    </>
  );
}
