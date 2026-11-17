import { Link } from 'react-router';
import { Badge } from '../../components/ui/index.js';
import { usePlatform } from '../platform/usePlatform.js';
import { formatMoney, cn } from '../../utils/format.js';

export const PRODUCT_TYPES = {
  TREASURY_BILL: 'Treasury bill',
  GOVERNMENT_BOND: 'Government bond',
  CORPORATE_BOND: 'Corporate bond',
  FIXED_DEPOSIT: 'Fixed deposit',
  MONEY_MARKET_FUND: 'Money market fund',
  FIXED_INCOME_FUND: 'Fixed income fund',
  EQUITY_FUND: 'Equity fund',
  BALANCED_FUND: 'Balanced fund',
  REAL_ESTATE: 'Real estate',
  OTHER: 'Other',
};

export const AVAILABILITY = {
  OPEN: { label: 'Open', tone: 'success' },
  UPCOMING: { label: 'Opening soon', tone: 'info' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  UNAVAILABLE: { label: 'Unavailable', tone: 'neutral' },
};

export const PRODUCT_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'warning' },
  CLOSED: { label: 'Closed', tone: 'info' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
};

export const RISK_LEVEL_LABEL = ['', 'Very low', 'Low', 'Low to medium', 'Medium', 'Medium to high', 'High', 'Very high'];

/** Formats an API money object { amountMinor, currency } using the platform's currency exponents. */
export function useMoney() {
  const { data } = usePlatform();
  return (m) => {
    if (!m) return '—';
    const units = data?.currencies?.find((c) => c.code === m.currency)?.minorUnits ?? 2;
    return formatMoney(m.amountMinor, m.currency, { minorUnits: units });
  };
}

export function formatTerm(days) {
  if (!days) return 'Open-ended';
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? '' : 's'}`;
  if (days >= 28 && days < 365) return `${days} days (~${Math.round(days / 30.4)} months)`;
  return `${days} days`;
}

export function rateLabel(p) {
  if (p.returnType === 'NONE' || !p.annualRatePercent) return { value: 'Variable', hint: 'No stated return' };
  return { value: `${p.annualRatePercent}% p.a.`, hint: p.returnType === 'FIXED' ? 'Fixed rate' : 'Target, not guaranteed' };
}

/** 1–7 scale. Colour plus a text label, so meaning never relies on colour alone. */
export function RiskMeter({ level, compact = false }) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      role="img"
      aria-label={`Risk level ${level} of 7: ${RISK_LEVEL_LABEL[level]}`}
    >
      <div className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-2 w-3 rounded-sm',
              i < level ? (level <= 2 ? 'bg-brand-500' : level <= 4 ? 'bg-warning' : 'bg-danger') : 'bg-surface-muted',
            )}
          />
        ))}
      </div>
      {!compact && <span className="text-xs whitespace-nowrap text-ink-muted">{RISK_LEVEL_LABEL[level]}</span>}
    </div>
  );
}

export function ProductCard({ product }) {
  const money = useMoney();
  const rate = rateLabel(product);
  const a = AVAILABILITY[product.availability];
  return (
    <Link
      to={`/investments/${product.slug}`}
      className="group flex flex-col rounded-card border border-border bg-surface p-5 shadow-card transition-shadow hover:shadow-overlay focus-visible:outline-2"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{PRODUCT_TYPES[product.productType]}</p>
        <Badge tone={a.tone}>{a.label}</Badge>
      </div>
      <h3 className="mt-2 text-lg font-semibold text-ink group-hover:text-brand-700">{product.name}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{product.shortDescription}</p>
      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
        <div>
          <dt className="text-xs text-ink-subtle">Return</dt>
          <dd className="tabular mt-0.5 font-semibold text-ink">{rate.value}</dd>
          <dd className="text-[11px] text-ink-subtle">{rate.hint}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">Term</dt>
          <dd className="mt-0.5 font-semibold text-ink">{product.termDays ? `${product.termDays} days` : 'Open'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">Minimum</dt>
          <dd className="tabular mt-0.5 font-semibold text-ink">{money(product.minInvestment)}</dd>
        </div>
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3">
        <RiskMeter level={product.riskLevel} />
        <span className="min-w-0 truncate text-right text-xs text-ink-subtle" title={product.issuerName}>
          {product.issuerName}
        </span>
      </div>
    </Link>
  );
}
