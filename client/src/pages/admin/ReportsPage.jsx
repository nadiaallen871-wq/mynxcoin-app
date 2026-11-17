import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileBarChart } from 'lucide-react';
import { Alert, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, Input, Select, Skeleton } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api, BASE } from '../../services/api.js';
import { REPORTS } from '../../features/admin/labels.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
const groupDigits = (s) => {
  const [w, f] = String(s).split('.');
  const neg = w.startsWith('-');
  return `${neg ? '-' : ''}${(neg ? w.slice(1) : w).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f !== undefined ? `.${f}` : ''}`;
};

export default function ReportsPage() {
  usePageMeta({ title: 'Reports · Mynx admin' });
  const [form, setForm] = useState({ kind: 'financial-summary', from: monthStart(), to: today() });
  const [applied, setApplied] = useState(form);
  const qs = `from=${applied.from}&to=${applied.to}`;
  const r = useQuery({
    queryKey: ['admin', 'reports', applied],
    queryFn: () => api.get(`/admin/reports/${applied.kind}?${qs}`).then((x) => x.data),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHeader
        title="Reports"
        description="Built from settled records and the ledger. Money columns are in GHS. Exports are recorded in the audit log."
      />
      <Card className="mb-6">
        <CardBody>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto] lg:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(form);
            }}
          >
            <Field label="Report">
              {(p) => (
                <Select
                  value={form.kind}
                  onChange={set('kind')}
                  options={Object.entries(REPORTS).map(([value, v]) => ({ value, label: v.label }))}
                  {...p}
                />
              )}
            </Field>
            <Field label="From">{(p) => <Input type="date" value={form.from} max={form.to} onChange={set('from')} {...p} />}</Field>
            <Field label="To">{(p) => <Input type="date" value={form.to} max={today()} onChange={set('to')} {...p} />}</Field>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800"
            >
              Run report
            </button>
          </form>
          <p className="mt-3 text-xs text-ink-subtle">{REPORTS[form.kind].description}</p>
        </CardBody>
      </Card>

      {r.isPending && <Skeleton className="h-60" />}
      {r.isError && <ErrorState error={r.error} onRetry={r.refetch} />}
      {r.data && (
        <Card>
          <CardHeader
            title={REPORTS[applied.kind].label}
            description={`${applied.from} to ${applied.to}`}
            actions={
              <a
                href={`${BASE}/api/v1/admin/reports/${applied.kind}?${qs}&format=csv`}
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline"
              >
                <Download className="size-4" aria-hidden="true" /> CSV
              </a>
            }
          />
          {r.data.truncated && (
            <Alert tone="warning" className="mx-5 mb-3">
              Showing the first 10,000 rows. Narrow the period for a complete export.
            </Alert>
          )}
          {r.data.rows.length ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{REPORTS[applied.kind].label}</caption>
                <thead className="text-left text-xs text-ink-subtle">
                  <tr>
                    {r.data.columns.map((c) => (
                      <th
                        key={c.key}
                        className={`px-5 py-2 font-medium whitespace-nowrap ${c.money || typeof r.data.rows[0][c.key] === 'number' ? 'text-right' : ''}`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {r.data.rows.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {r.data.columns.map((c) => (
                        <td
                          key={c.key}
                          className={`px-5 py-2 ${c.money || typeof row[c.key] === 'number' ? 'text-right whitespace-nowrap' : ''}`}
                        >
                          {c.money ? groupDigits(row[c.key]) : row[c.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {r.data.totals && (
                  <tfoot className="tabular font-semibold">
                    <tr className="border-t-2 border-border">
                      <th scope="row" className="px-5 py-2 text-left">
                        Total
                      </th>
                      {r.data.columns.slice(1).map((c) => (
                        <td key={c.key} className="px-5 py-2 text-right whitespace-nowrap">
                          {r.data.totals[c.key] !== undefined ? (c.money ? groupDigits(r.data.totals[c.key]) : r.data.totals[c.key]) : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <EmptyState icon={FileBarChart} title="No activity in this period" />
          )}
        </Card>
      )}
    </>
  );
}
