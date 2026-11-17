import { cn } from '../../utils/format.js';

export function Card({ as: Tag = 'section', className, children, ...props }) {
  return (
    <Tag className={cn('rounded-card border border-border bg-surface shadow-card', className)} {...props}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, actions, className }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4', className)}>
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

/** Metric tile for dashboards. `value` must be pre-formatted from backend data. */
export function StatCard({ label, value, hint, icon: Icon }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        {Icon && <Icon className="size-4 text-ink-subtle" aria-hidden="true" />}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
    </Card>
  );
}
