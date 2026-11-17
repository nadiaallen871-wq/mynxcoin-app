import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, SearchX } from 'lucide-react';
import { Alert, Card, EmptyState, ErrorState, Input, Pagination, Select, Skeleton } from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { PRODUCT_TYPES, ProductCard } from '../../features/investments/shared.jsx';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name' },
  { value: 'min_investment', label: 'Lowest minimum' },
  { value: 'risk_low', label: 'Lowest risk' },
  { value: 'risk_high', label: 'Highest risk' },
  { value: 'term', label: 'Shortest term' },
  { value: 'closing', label: 'Closing soonest' },
];

/** Public marketplace. Filters live in the URL so results can be shared and survive reloads. */
export default function MarketplacePage() {
  usePageMeta({
    title: 'Investments · Mynx',
    description:
      'Browse investment products with clear terms, fees and risk ratings. Investments carry risk. Past performance does not guarantee future results.',
  });
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const set = (key, value) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('search') ?? '') !== search.trim()) set('search', search.trim());
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = new URLSearchParams(params);
  if (!query.get('pageSize')) query.set('pageSize', '12');
  const categories = useQuery({
    queryKey: ['investments', 'categories'],
    queryFn: () => api.get('/investments/categories').then((r) => r.data),
    staleTime: 60_000,
  });
  const list = useQuery({
    queryKey: ['investments', 'list', query.toString()],
    queryFn: ({ signal }) => api.get(`/investments?${query}`, { signal }),
    placeholderData: keepPreviousData,
  });
  const page = Number(params.get('page') ?? 1);
  const filtered = ['search', 'category', 'type', 'maxRiskLevel', 'availability'].some((k) => params.get(k));

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 md:py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Investments</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        Compare terms, fees and risk before you invest. Every product lists its risks and documentation in full.
      </p>
      <Alert tone="warning" className="mt-6">
        Investing involves risk, including loss of capital. Target returns are not guaranteed, and past performance is not a reliable
        indicator of future results.
      </Alert>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside aria-label="Filters" className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Category</p>
            <ul className="space-y-1 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => set('category', '')}
                  className={!params.get('category') ? 'font-semibold text-brand-700' : 'text-ink-muted hover:text-ink'}
                >
                  All categories
                </button>
              </li>
              {categories.data?.map((c) => (
                <li key={c.slug}>
                  <button
                    type="button"
                    onClick={() => set('category', c.slug)}
                    aria-pressed={params.get('category') === c.slug}
                    className={params.get('category') === c.slug ? 'font-semibold text-brand-700' : 'text-ink-muted hover:text-ink'}
                  >
                    {c.name} <span className="tabular text-ink-subtle">({c.productCount})</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <Select
            aria-label="Product type"
            value={params.get('type') ?? ''}
            onChange={(e) => set('type', e.target.value)}
            placeholder="All product types"
            options={Object.entries(PRODUCT_TYPES).map(([value, label]) => ({ value, label }))}
          />
          <Select
            aria-label="Maximum risk level"
            value={params.get('maxRiskLevel') ?? ''}
            onChange={(e) => set('maxRiskLevel', e.target.value)}
            placeholder="Any risk level"
            options={[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `Risk level ${n} or lower` }))}
          />
          <Select
            aria-label="Availability"
            value={params.get('availability') ?? ''}
            onChange={(e) => set('availability', e.target.value)}
            placeholder="Any availability"
            options={[
              { value: 'OPEN', label: 'Open now' },
              { value: 'UPCOMING', label: 'Opening soon' },
              { value: 'CLOSED', label: 'Closed' },
            ]}
          />
        </aside>

        <section aria-label="Results">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
              <Input
                aria-label="Search investments"
                placeholder="Search by name or issuer"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              aria-label="Sort by"
              value={params.get('sort') ?? 'newest'}
              onChange={(e) => set('sort', e.target.value === 'newest' ? '' : e.target.value)}
              options={SORTS}
              className="sm:w-48"
            />
          </div>

          {list.isPending && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-60" />
              ))}
            </div>
          )}
          {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
          {list.data && list.data.data.length === 0 && (
            <Card>
              <EmptyState
                icon={SearchX}
                title={filtered ? 'No investments match your filters' : 'No investments are available yet'}
                description={
                  filtered
                    ? 'Try removing a filter or searching for something else.'
                    : 'New products appear here once our team has reviewed and published them.'
                }
              />
            </Card>
          )}
          {list.data && list.data.data.length > 0 && (
            <>
              <p className="mb-3 text-sm text-ink-muted" aria-live="polite">
                <span className="tabular">{list.data.meta.total}</span> investment{list.data.meta.total === 1 ? '' : 's'}
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.data.data.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
              {list.data.meta.total > list.data.meta.pageSize && (
                <Card className="mt-6">
                  <Pagination
                    page={page}
                    pageSize={list.data.meta.pageSize}
                    total={list.data.meta.total}
                    onPageChange={(n) => set('page', String(n))}
                  />
                </Card>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
