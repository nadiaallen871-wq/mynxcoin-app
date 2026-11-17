import { forwardRef, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/format.js';

const control =
  'w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-600 disabled:bg-surface-muted disabled:text-ink-subtle';

/** Label + hint + error wrapper. It wires up aria-describedby and aria-invalid for the child control. */
export function Field({ label, hint, error, required, children, className }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children({
        id,
        'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
        required,
      })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(control, 'h-10', invalid || props['aria-invalid'] ? 'border-danger' : 'border-border-strong', className)}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(control, 'min-h-24 py-2', props['aria-invalid'] ? 'border-danger' : 'border-border-strong', className)}
      {...props}
    />
  );
});

export const Select = forwardRef(function Select({ className, options = [], placeholder, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(control, 'h-10 appearance-none pr-9', props['aria-invalid'] ? 'border-danger' : 'border-border-strong', className)}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
    </div>
  );
});
