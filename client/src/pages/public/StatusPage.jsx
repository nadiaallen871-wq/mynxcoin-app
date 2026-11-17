import { Activity, Database, Server, Workflow } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton } from '../../components/ui/index.js';
import { usePlatform, useSystemHealth } from '../../features/platform/usePlatform.js';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const TONE = {
  up: 'success',
  ok: 'success',
  degraded: 'warning',
  stale: 'warning',
  down: 'danger',
  unavailable: 'danger',
  unknown: 'neutral',
};
const LABEL = {
  up: 'Operational',
  ok: 'All systems operational',
  degraded: 'Degraded',
  stale: 'Delayed',
  down: 'Down',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

const CHECKS = [
  { key: 'database', label: 'Database', icon: Database },
  { key: 'redis', label: 'Cache and queues', icon: Server },
  { key: 'worker', label: 'Background processing', icon: Workflow },
];

export default function StatusPage() {
  usePageMeta({ title: 'System status · Mynx', description: 'Live operational status of Mynx platform services.' });
  const health = useSystemHealth();
  const platform = usePlatform();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 md:py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">System status</h1>
      <p className="mt-2 text-ink-muted">Live readiness checks reported by the API, refreshed every 15 seconds.</p>

      <Card className="mt-8">
        <CardHeader
          title="Services"
          description={health.data ? `Last checked ${formatDateTime(health.data.time)}` : undefined}
          actions={health.data && <Badge tone={TONE[health.data.status]}>{LABEL[health.data.status]}</Badge>}
        />
        {health.isPending && (
          <CardBody className="space-y-3">
            {CHECKS.map((c) => (
              <Skeleton key={c.key} className="h-10" />
            ))}
          </CardBody>
        )}
        {health.isError && <ErrorState title="Could not reach the API" error={health.error} onRetry={() => health.refetch()} />}
        {health.data && (
          <ul className="divide-y divide-border">
            {CHECKS.map(({ key, label, icon: Icon }) => {
              const check = health.data.checks[key] ?? { status: 'unknown' };
              return (
                <li key={key} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <span className="flex items-center gap-3 text-sm font-medium text-ink">
                    <Icon className="size-4 text-ink-subtle" aria-hidden="true" />
                    {label}
                  </span>
                  <span className="flex items-center gap-3">
                    {check.latencyMs !== undefined && <span className="tabular text-xs text-ink-subtle">{check.latencyMs} ms</span>}
                    <Badge tone={TONE[check.status]}>{LABEL[check.status]}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Environment" />
        <CardBody>
          {platform.isPending && <Skeleton className="h-6 w-48" />}
          {platform.isError && <p className="text-sm text-danger">Platform information unavailable.</p>}
          {platform.data && (
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-subtle">Mode</dt>
                <dd className="mt-1">
                  <Badge tone={platform.data.mode === 'live' ? 'success' : 'warning'}>
                    <Activity className="size-3" aria-hidden="true" />
                    {platform.data.mode === 'live' ? 'Live' : 'Sandbox'}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">API version</dt>
                <dd className="mt-1 font-medium text-ink">{platform.data.apiVersion}</dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Active currencies</dt>
                <dd className="mt-1 font-medium text-ink">{platform.data.currencies.map((c) => c.code).join(', ') || 'None'}</dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
