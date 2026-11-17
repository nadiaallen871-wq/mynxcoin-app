import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/format.js';
import { Button } from './Button.jsx';

/**
 * Modal built on the native <dialog> element, which provides focus trapping,
 * Escape-to-close and inert background for free (WCAG 2.2).
 */
function useDialog(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const handleCancel = (e) => {
      e.preventDefault();
      onClose?.();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);
  return ref;
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn('m-auto w-[calc(100%-2rem)] rounded-card bg-surface p-0 shadow-overlay backdrop:bg-navy-950/50', widths[size])}
    >
      {open && (
        <div className="animate-fade-in">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold text-ink">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-ink-subtle hover:bg-surface-muted"
              aria-label="Close dialog"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for irreversible actions. The confirm button states the action. */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel, tone = 'primary', loading }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-muted">{children}</div>
    </Modal>
  );
}

export function Drawer({ open, onClose, title, children, footer }) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="ml-auto h-dvh max-h-dvh w-full max-w-md bg-surface p-0 shadow-overlay backdrop:bg-navy-950/50"
    >
      {open && (
        <div className="flex h-full animate-slide-in flex-col">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-ink-subtle hover:bg-surface-muted"
              aria-label="Close panel"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
