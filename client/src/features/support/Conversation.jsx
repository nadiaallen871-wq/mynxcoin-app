import { useRef, useState } from 'react';
import { Lock, Paperclip } from 'lucide-react';
import { Alert, Button, Field, Textarea } from '../../components/ui/index.js';
import { BASE } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';

/** Ticket thread. Customer messages sit on the right; internal notes (staff only) are marked. */
export function Thread({ messages, viewer = 'customer' }) {
  return (
    <ol className="space-y-4">
      {messages.map((m) => {
        const mine = viewer === 'customer' ? m.fromCustomer : !m.fromCustomer;
        return (
          <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
                m.internal
                  ? 'border border-dashed border-warning bg-warning-soft'
                  : mine
                    ? 'bg-navy-900 text-white'
                    : 'border border-border bg-surface'
              }`}
            >
              <p className={`mb-1 flex items-center gap-1 text-xs ${mine && !m.internal ? 'text-white/70' : 'text-ink-subtle'}`}>
                {m.internal && <Lock className="size-3" aria-hidden="true" />}
                {m.internal
                  ? 'Internal note'
                  : viewer === 'customer'
                    ? m.fromCustomer
                      ? 'You'
                      : `${m.author} (Mynx support)`
                    : m.fromCustomer
                      ? 'Customer'
                      : m.author}
                {' · '}
                {formatDateTime(m.createdAt)}
              </p>
              <p className="break-words whitespace-pre-line">{m.body}</p>
              {m.attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {m.attachments.map((a) => (
                    <li key={a.id}>
                      <a
                        href={`${BASE}/api/v1/support/attachments/${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs underline"
                      >
                        <Paperclip className="size-3" aria-hidden="true" /> {a.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Message box with up to three attachments (JPEG, PNG or PDF). Sends multipart form data. */
export function ReplyBox({ onSend, pending, error, label = 'Reply', extra = null, submitLabel = 'Send' }) {
  const [body, setBody] = useState('');
  const fileRef = useRef(null);
  const [files, setFiles] = useState([]);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.append('body', body);
        files.forEach((f) => fd.append('files', f));
        const ok = await onSend(fd);
        if (ok !== false) {
          setBody('');
          setFiles([]);
          if (fileRef.current) fileRef.current.value = '';
        }
      }}
    >
      {error && <Alert tone="danger">{error.message}</Alert>}
      <Field label={label}>
        {(p) => <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} {...p} />}
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
          <Paperclip className="size-4" aria-hidden="true" />
          <span className="underline">Attach files</span>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,application/pdf"
            className="sr-only"
            onChange={(e) => setFiles([...e.target.files].slice(0, 3))}
          />
          {files.length > 0 && <span className="text-xs">({files.map((f) => f.name).join(', ')})</span>}
        </label>
        <div className="flex items-center gap-3">
          {extra}
          <Button type="submit" loading={pending} disabled={!body.trim()}>
            {submitLabel}
          </Button>
        </div>
      </div>
      <p className="text-xs text-ink-subtle">Up to 3 files, JPEG, PNG or PDF. Never send passwords, PINs or full card numbers.</p>
    </form>
  );
}
