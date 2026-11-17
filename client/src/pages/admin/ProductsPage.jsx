import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Package, Plus } from 'lucide-react';
import { Badge, Card, DataTable, EmptyState, ErrorState, Input, Pagination, Skeleton } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { PRODUCT_STATUS, PRODUCT_TYPES, RiskMeter, rateLabel, useMoney } from '../../features/investments/shared.jsx';
import { cn, formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const TABS = ['', 'DRAFT', 'PUBLISHED', 'SUSPENDED', 'CLOSED', 'ARCHIVED'];

export default function ProductsPage() {
  usePageMeta({ title: 'Products · Mynx Admin' });
  const { data: session } = useSession();
  const money = useMoney();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: '25',
    ...(status ? { status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  });
  const list = useQuery({
    queryKey: ['admin', 'products', params.toString()],
    queryFn: () => api.get(`/admin/products?${params}`),
    placeholderData: keepPreviousData,
  });
  const counts = list.data?.meta.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Investment products"
        description="Drafts are private. Publishing needs a second person, and published terms are locked."
        actions={
          hasPermission(session, 'products:manage') && (
            <Link
              to="/admin/products/new"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800"
            >
              <Plus className="size-4" aria-hidden="true" /> New product
            </Link>
          )
        }
      />
      <Card>
        <div role="tablist" aria-label="Product status" className="relative flex gap-1 overflow-x-auto border-b border-border px-2">
          {TABS.map((t) => (
            <button
              key={t || 'all'}
              role="tab"
              type="button"
              aria-selected={status === t}
              onClick={() => {
                setStatus(t);
                setPage(1);
              }}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap',
                status === t ? 'border-brand-600 text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {t ? PRODUCT_STATUS[t].label : 'All'}
              <span className="tabular rounded-full bg-surface-muted px-2 text-xs">{t ? (counts[t] ?? 0) : total}</span>
            </button>
          ))}
        </div>
        <div className="border-b border-border p-4">
          <Input
            aria-label="Search products"
            placeholder="Search name or issuer"
            className="max-w-md"
            value={search}
            onChange={(e) => (setSearch(e.target.value), setPage(1))}
          />
        </div>
        {list.isPending && <Skeleton className="m-4 h-40" />}
        {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
        {list.data && (
          <>
            <DataTable
              caption="Investment products"
              rows={list.data.data}
              empty={<EmptyState icon={Package} title="No products" description="Create a draft to get started." />}
              columns={[
                {
                  key: 'name',
                  header: 'Product',
                  render: (p) => (
                    <Link to={`/admin/products/${p.id}`} className="group block">
                      <span className="block font-medium text-ink group-hover:text-brand-700 group-hover:underline">{p.name}</span>
                      <span className="block text-xs text-ink-subtle">
                        {PRODUCT_TYPES[p.productType]} · {p.issuerName}
                      </span>
                    </Link>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (p) => <Badge tone={PRODUCT_STATUS[p.status].tone}>{PRODUCT_STATUS[p.status].label}</Badge>,
                },
                { key: 'rate', header: 'Return', render: (p) => rateLabel(p).value },
                { key: 'min', header: 'Minimum', align: 'right', render: (p) => money(p.minInvestment) },
                { key: 'risk', header: 'Risk', render: (p) => <RiskMeter level={p.riskLevel} compact /> },
                { key: 'version', header: 'Version', render: (p) => (p.version ? `v${p.version}` : '—') },
                { key: 'updatedAt', header: 'Updated', render: (p) => formatDateTime(p.updatedAt) },
              ]}
            />
            <Pagination page={page} pageSize={25} total={list.data.meta.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
