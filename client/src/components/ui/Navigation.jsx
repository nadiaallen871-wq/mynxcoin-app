import { useId, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../utils/format.js';
import { Button } from './Button.jsx';

/** Accessible tabs (WAI-ARIA tabs pattern with arrow-key navigation). */
export function Tabs({ tabs, value, onChange, className }) {
  const baseId = useId();
  const listRef = useRef(null);
  const active = tabs.find((t) => t.value === value) ?? tabs[0];

  const onKeyDown = (e) => {
    const index = tabs.findIndex((t) => t.value === active.value);
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    onChange(next.value);
    listRef.current?.querySelector(`[data-value="${next.value}"]`)?.focus();
  };

  return (
    <div className={className}>
      <div ref={listRef} role="tablist" onKeyDown={onKeyDown} className="relative flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((tab) => {
          const selected = tab.value === active.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.value}`}
              data-value={tab.value}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.value)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                selected ? 'border-brand-600 text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${baseId}-panel-${active.value}`} aria-labelledby={`${baseId}-tab-${active.value}`} className="pt-4">
        {active.content}
      </div>
    </div>
  );
}

/**
 * Data table. Columns: { key, header, render?, align?: 'left' | 'right' }.
 * Numeric and financial columns should use align="right" so figures line up.
 */
export function DataTable({ columns, rows, rowKey = 'id', caption, empty }) {
  if (!rows.length && empty) return empty;
  return (
    // "relative" contains the absolutely positioned sr-only caption, so it cannot widen the page on small screens.
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border text-xs tracking-wide text-ink-subtle uppercase">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-4 py-2.5 font-medium', c.align === 'right' && 'text-right')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row[rowKey]} className="hover:bg-surface-muted/60">
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 py-3 text-ink', c.align === 'right' && 'tabular text-right')}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPageChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-ink-muted">
      <p>
        Showing <span className="tabular font-medium text-ink">{from}</span>–<span className="tabular font-medium text-ink">{to}</span> of{' '}
        <span className="tabular font-medium text-ink">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <span className="tabular">
          Page {page} of {pages}
        </span>
        <Button variant="secondary" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
