import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Download, FileText, X } from 'lucide-react';
import { Alert, Badge, Card, CardBody, CardHeader, ErrorState, Skeleton } from '../../components/ui/index.js';
import { api, BASE } from '../../services/api.js';
import { AVAILABILITY, PRODUCT_TYPES, RiskMeter, formatTerm, rateLabel, useMoney } from '../../features/investments/shared.jsx';
import { InvestPanel } from '../../features/investments/InvestPanel.jsx';
import { ProjectionCalculator } from '../../features/investments/Calculator.jsx';
import { RISK_PROFILES } from '../../features/kyc/labels.js';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import NotFoundPage from './NotFoundPage.jsx';

const DOC_KINDS = {
  KEY_INFORMATION: 'Key information',
  TERM_SHEET: 'Term sheet',
  PROSPECTUS: 'Prospectus',
  RISK_DISCLOSURE: 'Risk disclosure',
  ANNUAL_REPORT: 'Annual report',
  OTHER: 'Document',
};

function Eligibility({ eligibility, slug, product }) {
  const next = encodeURIComponent(`/investments/${slug}`);
  return (
    <Card>
      <CardHeader title="Can I invest?" />
      <CardBody className="space-y-3 text-sm">
        <ul className="space-y-2">
          {eligibility.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-2">
              {c.ok ? (
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Met" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-label="Not met" />
              )}
              <span className={c.ok ? 'text-ink' : 'text-ink-muted'}>
                {c.key === 'signedIn' && !c.ok ? (
                  <>
                    <Link to={`/login?next=${next}`} className="font-medium text-brand-700 underline">
                      Sign in
                    </Link>{' '}
                    or{' '}
                    <Link to="/register" className="font-medium text-brand-700 underline">
                      open an account
                    </Link>
                  </>
                ) : c.key === 'verified' && !c.ok ? (
                  <Link to="/app/verification" className="font-medium text-brand-700 underline">
                    {c.message}
                  </Link>
                ) : (
                  c.message
                )}
              </span>
            </li>
          ))}
        </ul>
        {eligibility.suitability && !eligibility.suitability.suitable && (
          <Alert tone="warning" title="This may not suit you">
            Your risk profile is <strong>{RISK_PROFILES[eligibility.suitability.investorProfile]}</strong>. This product is designed for
            investors who are at least <strong>{RISK_PROFILES[eligibility.suitability.productMinimum]}</strong>.
          </Alert>
        )}
        <p className="rounded-md bg-surface-muted p-3 text-xs text-ink-muted">{eligibility.notice}</p>
        {eligibility.eligible && <InvestPanel product={product} eligibility={eligibility} />}
      </CardBody>
    </Card>
  );
}

export default function ProductDetailPage() {
  const { slug } = useParams();
  const money = useMoney();
  const product = useQuery({
    queryKey: ['investments', 'detail', slug],
    queryFn: () => api.get(`/investments/${slug}`).then((r) => r.data),
    retry: false,
  });
  usePageMeta({ title: product.data ? `${product.data.name} · Mynx` : 'Investment · Mynx', description: product.data?.shortDescription });

  if (product.isPending) return <Skeleton className="mx-auto my-10 h-96 max-w-6xl" />;
  if (product.error?.status === 404) return <NotFoundPage />;
  if (product.isError) return <ErrorState error={product.error} onRetry={product.refetch} />;

  const p = product.data;
  const rate = rateLabel(p);
  const a = AVAILABILITY[p.availability];
  const fees = [
    ['Entry fee', p.fees.entryPercent],
    ['Annual management fee', p.fees.managementPercent],
    ['Early exit fee', p.fees.earlyExitPercent],
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Link to="/investments" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" /> All investments
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink-subtle">
            {PRODUCT_TYPES[p.productType]} · {p.category.name}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">{p.name}</h1>
          <p className="mt-2 max-w-2xl text-ink-muted">{p.shortDescription}</p>
          <p className="mt-2 text-sm text-ink-subtle">Issuer: {p.issuerName}</p>
        </div>
        <Badge tone={a.tone}>{a.label}</Badge>
      </div>

      <Card className="mt-6">
        <dl className="grid grid-cols-2 gap-6 p-5 text-sm md:grid-cols-5">
          <div>
            <dt className="text-ink-subtle">Return</dt>
            <dd className="tabular mt-1 text-xl font-semibold text-ink">{rate.value}</dd>
            <dd className="text-xs text-ink-subtle">{rate.hint}</dd>
          </div>
          <div>
            <dt className="text-ink-subtle">Term</dt>
            <dd className="mt-1 text-xl font-semibold text-ink">{formatTerm(p.termDays)}</dd>
            {p.maturityDate && <dd className="text-xs text-ink-subtle">Matures {p.maturityDate}</dd>}
          </div>
          <div>
            <dt className="text-ink-subtle">Minimum</dt>
            <dd className="tabular mt-1 text-xl font-semibold text-ink">{money(p.minInvestment)}</dd>
            {p.maxInvestment && <dd className="text-xs text-ink-subtle">Maximum {money(p.maxInvestment)}</dd>}
          </div>
          <div>
            <dt className="text-ink-subtle">Risk</dt>
            <dd className="mt-2">
              <RiskMeter level={p.riskLevel} />
            </dd>
          </div>
          <div>
            <dt className="text-ink-subtle">Suitable for</dt>
            <dd className="mt-1 font-medium text-ink">{RISK_PROFILES[p.minRiskProfile]} and above</dd>
          </div>
        </dl>
        {(p.subscriptionOpensAt || p.subscriptionClosesAt) && (
          <p className="border-t border-border px-5 py-3 text-sm text-ink-muted">
            Subscription window: {p.subscriptionOpensAt ? formatDateTime(p.subscriptionOpensAt) : 'open now'} –{' '}
            {p.subscriptionClosesAt ? formatDateTime(p.subscriptionClosesAt) : 'until further notice'}
          </p>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="About this investment" />
            <CardBody>
              <p className="text-sm leading-relaxed whitespace-pre-line text-ink-muted">{p.description}</p>
            </CardBody>
          </Card>

          <Card className="border-warning/40">
            <CardHeader title="Risks you should understand" />
            <CardBody>
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
                <p className="text-sm leading-relaxed whitespace-pre-line text-ink-muted">{p.riskDisclosure}</p>
              </div>
              <p className="mt-4 text-xs text-ink-subtle">
                See also our general{' '}
                <Link to="/risk-disclosures" className="underline">
                  risk disclosures
                </Link>
                .
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Fees and access to your money" />
            <CardBody className="space-y-4 text-sm">
              <dl className="grid gap-3 sm:grid-cols-3">
                {fees.map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-surface-muted p-3">
                    <dt className="text-xs text-ink-subtle">{label}</dt>
                    <dd className="tabular mt-1 font-semibold text-ink">{Number(value) === 0 ? 'None' : `${value}%`}</dd>
                  </div>
                ))}
              </dl>
              {p.fees.notes && <p className="text-ink-muted">{p.fees.notes}</p>}
              <div>
                <p className="font-medium text-ink">Redemption</p>
                <p className="mt-1 text-ink-muted">{p.redemptionTerms}</p>
                {p.lockupDays ? <p className="mt-1 text-ink-muted">Lock-up period: {p.lockupDays} days.</p> : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Calculate an illustration"
              description="Uses this product’s rate, term and fees. Calculated by our servers."
            />
            <CardBody>
              <ProjectionCalculator product={p} />
            </CardBody>
          </Card>

          {p.performance.length > 0 && (
            <Card>
              <CardHeader title="Historical performance" description="Past performance is not a reliable indicator of future results." />
              <div className="relative overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Historical performance by period</caption>
                  <thead>
                    <tr className="border-b border-border text-xs tracking-wide text-ink-subtle uppercase">
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        Period
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right font-medium">
                        Return
                      </th>
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        Source
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {p.performance.map((r) => (
                      <tr key={r.id}>
                        <td className="px-5 py-3 text-ink">
                          {r.periodStart} – {r.periodEnd}
                        </td>
                        <td
                          className={`tabular px-5 py-3 text-right font-medium ${r.returnPercent.startsWith('-') ? 'text-danger' : 'text-ink'}`}
                        >
                          {r.returnPercent}%
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {r.sourceUrl ? (
                            <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                              {r.source}
                            </a>
                          ) : (
                            r.source
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Eligibility eligibility={p.eligibility} slug={p.slug} product={p} />
          <Card>
            <CardHeader title="Documents" description="Read these before investing." />
            <ul className="divide-y divide-border">
              {p.documents.map((d) => (
                <li key={d.id}>
                  <a
                    href={`${BASE}/api/v1/investments/${p.slug}/documents/${d.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-muted"
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="size-4 text-ink-subtle" aria-hidden="true" />
                      <span>
                        <span className="block font-medium text-ink">{d.title}</span>
                        <span className="text-xs text-ink-subtle">
                          {DOC_KINDS[d.kind]} · PDF · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB
                        </span>
                      </span>
                    </span>
                    <Download className="size-4 text-ink-subtle" aria-label="Download" />
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
