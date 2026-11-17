import { AlertTriangle, CheckCircle2, Info, Inbox, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../utils/format.js';
import { Button } from './Button.jsx';

const TONES = {
  neutral: 'bg-surface-muted text-ink-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/** Status pill. Colour is never the only signal: the label text carries the meaning. */
export function Badge({ tone = 'neutral', dot = true, className, children }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Spinner({ label = 'Loading', className }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-ink-muted', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-surface-muted', className)} />;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-surface-muted p-3">
        <Icon className="size-6 text-ink-subtle" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', error, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-danger-soft p-3">
        <XCircle className="size-6 text-danger" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{error?.message ?? 'Please try again.'}</p>
      {error?.requestId && <p className="mt-1 font-mono text-xs text-ink-subtle">Reference: {error.requestId}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

const ALERT_ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };

export function Alert({ tone = 'info', title, children, className }) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'note'} className={cn('flex gap-3 rounded-lg p-4 text-sm', TONES[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn(title && 'mt-0.5', 'text-ink-muted')}>{children}</div>
      </div>
    </div>
  );
}
