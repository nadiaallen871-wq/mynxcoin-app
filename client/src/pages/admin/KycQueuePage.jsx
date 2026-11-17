import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Search } from 'lucide-react';
import { Badge, Card, DataTable, EmptyState, ErrorState, Input, Pagination, Skeleton } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { KYC_STATUS, SCREENING_STATUS } from '../../features/kyc/labels.js';
import { formatDateTime, cn } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const TABS = [
  { value: 'SUBMITTED', label: 'Awaiting review' },
  { value: 'UNDER_REVIEW', label: 'In review' },
  { value: 'RESUBMISSION_REQUIRED', label: 'With applicant' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

export default function KycQueuePage() {
  usePageMeta({ title: 'KYC review · Mynx Admin' });
  const [status, setStatus] = useState('SUBMITTED');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [status, q]);

  const params = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize), ...(q ? { search: q } : {}) });
  const list = useQuery({
    queryKey: ['admin', 'kyc', params.toString()],
    queryFn: () => api.get(`/admin/kyc/applications?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const counts = list.data?.meta.counts ?? {};

  return (
    <>
      <PageHeader title="KYC review" description="Identity verification applications, oldest first." />
      <Card>
        <div role="tablist" aria-label="Application status" className="relative flex gap-1 overflow-x-auto border-b border-border px-2">
          {TABS.map((t) => (
            <button
              key={t.value}
              role="tab"
              type="button"
              aria-selected={status === t.value}
              onClick={() => setStatus(t.value)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap',
                status === t.value ? 'border-brand-600 text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {t.label}
              <span className="tabular rounded-full bg-surface-muted px-2 text-xs">{counts[t.value] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="border-b border-border p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
            <Input
              aria-label="Search applicants"
              placeholder="Search name, email or organisation"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {list.isPending && <Skeleton className="m-4 h-40" />}
        {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
        {list.data && (
          <>
            <DataTable
              caption="KYC applications"
              rows={list.data.data}
              empty={<EmptyState icon={ClipboardCheck} title="Nothing here" description="No applications match this status and search." />}
              columns={[
                {
                  key: 'applicant',
                  header: 'Applicant',
                  render: (a) => (
                    <Link to={`/admin/kyc/${a.id}`} className="group block">
                      <span className="block font-medium text-ink group-hover:text-brand-700 group-hover:underline">
                        {a.applicant.organizationName ?? a.applicant.name}
                      </span>
                      <span className="block text-xs text-ink-subtle">{a.applicant.email}</span>
                    </Link>
                  ),
                },
                { key: 'type', header: 'Type', render: (a) => (a.applicant.type === 'INSTITUTIONAL' ? 'Organisation' : 'Individual') },
                {
                  key: 'screening',
                  header: 'Screening',
                  render: (a) =>
                    a.screeningStatus ? (
                      <Badge tone={SCREENING_STATUS[a.screeningStatus].tone}>{SCREENING_STATUS[a.screeningStatus].label}</Badge>
                    ) : (
                      '—'
                    ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (a) => <Badge tone={KYC_STATUS[a.status].tone}>{KYC_STATUS[a.status].label}</Badge>,
                },
                { key: 'reviewer', header: 'Reviewer', render: (a) => a.reviewer ?? '—' },
                {
                  key: 'submittedAt',
                  header: 'Submitted',
                  render: (a) => `${formatDateTime(a.submittedAt)}${a.submissionCount > 1 ? ` (#${a.submissionCount})` : ''}`,
                },
              ]}
            />
            <Pagination page={page} pageSize={pageSize} total={list.data.meta.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
