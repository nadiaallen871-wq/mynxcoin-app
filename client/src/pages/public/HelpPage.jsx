import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Search } from 'lucide-react';
import { EmptyState, ErrorState, Input, Skeleton } from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

/** Public help centre: published FAQ entries, searchable, grouped by topic. */
export default function HelpPage() {
  usePageMeta({
    title: 'Help centre · Mynx',
    description: 'Answers to common questions about Mynx accounts, deposits, withdrawals and investments.',
  });
  const [q, setQ] = useState('');
  const faqs = useQuery({ queryKey: ['faqs'], queryFn: () => api.get('/support/faqs').then((r) => r.data) });
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (faqs.data ?? []).filter((f) => !needle || `${f.question} ${f.answer}`.toLowerCase().includes(needle));
    return rows.reduce((acc, f) => ({ ...acc, [f.category]: [...(acc[f.category] ?? []), f] }), {});
  }, [faqs.data, q]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Help centre</h1>
      <p className="mt-2 text-ink-muted">
        Can’t find an answer?{' '}
        <Link to="/app/support" className="font-medium text-brand-700 underline">
          Contact support
        </Link>{' '}
        (sign-in required).
      </p>
      <div className="relative mt-6">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
        <Input
          className="pl-9"
          type="search"
          placeholder="Search questions"
          aria-label="Search questions"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="mt-8 space-y-8">
        {faqs.isPending && <Skeleton className="h-60" />}
        {faqs.isError && <ErrorState error={faqs.error} onRetry={faqs.refetch} />}
        {faqs.data && !Object.keys(groups).length && <EmptyState title={q ? 'No matching questions' : 'No questions published yet'} />}
        {Object.entries(groups).map(([category, items]) => (
          <section key={category}>
            <h2 className="mb-3 text-lg font-semibold text-ink">{category}</h2>
            <div className="divide-y divide-border rounded-card border border-border bg-surface">
              {items.map((f) => (
                <details key={f.id} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-ink">
                    {f.question}
                    <ChevronDown
                      className="size-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="mt-3 text-sm whitespace-pre-line text-ink-muted">{f.answer}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
