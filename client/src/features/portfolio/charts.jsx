import { useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMoney } from '../investments/shared.jsx';

// Single-series marks use the brand colour (validated: contrast ≥ 3:1 on the white surface).
const SERIES = 'var(--color-brand-600)';
const GRID = 'var(--color-border)';
const INK_MUTED = 'var(--color-ink-muted)';

const compact = new Intl.NumberFormat('en-GH', { notation: 'compact', maximumFractionDigits: 1 });
const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function HistoryTooltip({ active, payload, money, currency }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const row = (label, minor) => (
    <div className="flex justify-between gap-6">
      <span className="text-ink-muted">{label}</span>
      <span className="tabular font-medium text-ink">{money({ amountMinor: minor, currency })}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-overlay">
      <p className="mb-1 font-semibold text-ink">{shortDate(p.date)}</p>
      {row('Total value', p.totalMinor)}
      {row('Wallet', p.walletMinor)}
      {row('Investments', p.holdingsMinor)}
    </div>
  );
}

/**
 * Total value over time (wallet + investments at their stated valuation). One series,
 * so the title names it and there is no legend box. A table view carries the same data.
 */
export function ValueHistoryChart({ points, currency = 'GHS', height = 240 }) {
  const money = useMoney();
  const [asTable, setAsTable] = useState(false);
  const gradientId = useId().replace(/:/g, '');
  if (!points?.length)
    return <p className="py-10 text-center text-sm text-ink-muted">Your value history starts with your first deposit.</p>;
  const data = points.map((p) => ({ ...p, total: Number(p.totalMinor) / 100 }));
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" className="text-xs font-medium text-brand-700 underline" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {asTable ? (
        <div className="relative max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Total value by date</caption>
            <thead className="text-left text-xs text-ink-subtle">
              <tr>
                <th className="py-1 pr-3 font-medium">Date</th>
                <th className="py-1 pr-3 text-right font-medium">Wallet</th>
                <th className="py-1 pr-3 text-right font-medium">Investments</th>
                <th className="py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {[...points].reverse().map((p) => (
                <tr key={p.date} className="border-t border-border">
                  <td className="py-1 pr-3">{shortDate(p.date)}</td>
                  <td className="py-1 pr-3 text-right">{money({ amountMinor: p.walletMinor, currency })}</td>
                  <td className="py-1 pr-3 text-right">{money({ amountMinor: p.holdingsMinor, currency })}</td>
                  <td className="py-1 text-right font-medium">{money({ amountMinor: p.totalMinor, currency })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          style={{ height }}
          role="img"
          aria-label={`Total value over ${points.length} points, latest ${money({ amountMinor: points.at(-1).totalMinor, currency })}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="0" />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fontSize: 11, fill: INK_MUTED }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                tickFormatter={(v) => compact.format(v)}
                tick={{ fontSize: 11, fill: INK_MUTED }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                content={<HistoryTooltip money={money} currency={currency} />}
                cursor={{ stroke: INK_MUTED, strokeWidth: 1, strokeDasharray: '3 3' }}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke={SERIES}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)', fill: SERIES }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/**
 * Share of value by group as labelled horizontal bars (one hue: the label carries identity,
 * so colour never has to). Each row shows the value and percentage as text.
 */
export function AllocationBars({ groups, currency = 'GHS', labelOf = (g) => g.label }) {
  const money = useMoney();
  if (!groups?.length) return <p className="py-6 text-center text-sm text-ink-muted">Nothing invested yet.</p>;
  return (
    <ul className="space-y-3">
      {groups.map((g) => {
        const pct = g.shareBasisPoints / 100;
        return (
          <li key={g.key} title={`${labelOf(g)}: ${money({ amountMinor: g.valueMinor, currency })} (${pct.toFixed(1)}%)`}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="min-w-0 text-ink">{labelOf(g)}</span>
              <span className="tabular text-ink-muted">
                {money({ amountMinor: g.valueMinor, currency })} · {pct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-muted" aria-hidden="true">
              <div className="h-2 rounded-full" style={{ width: `${Math.max(pct, 1)}%`, background: SERIES }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
