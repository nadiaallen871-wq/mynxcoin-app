import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Upload } from 'lucide-react';
import { Badge, Button } from '../../components/ui/index.js';
import { api, BASE } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { ONBOARDING_KEY } from './OnboardingForms.jsx';
import { DOC_STATUS, DOCUMENT_TYPES } from './labels.js';

/** Opens a document through a short-lived signed URL (the request is logged server-side). */
export async function openDocument(id) {
  // The window opens synchronously, inside the click, so popup blockers allow it. The URL is filled in once issued.
  const win = window.open('', '_blank');
  try {
    const { data } = await api.get(`/documents/${id}/download-url`);
    if (win) {
      win.opener = null;
      win.location.href = `${BASE}${data.url}`;
    } else {
      window.location.assign(`${BASE}${data.url}`);
    }
  } catch (err) {
    win?.close();
    throw err;
  }
}

function DocumentRow({ type, status, document, disabled }) {
  const input = useRef(null);
  const qc = useQueryClient();
  const toast = useToast();
  const upload = useMutation({
    mutationFn: (file) => {
      const body = new FormData();
      body.append('type', type);
      body.append('file', file);
      return api.post('/documents', body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ONBOARDING_KEY });
      toast.success('Document uploaded');
    },
    onError: (err) => toast.error('Upload failed', err.message),
  });
  const meta = DOCUMENT_TYPES[type];
  const s = DOC_STATUS[status];

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <FileCheck2 className="mt-0.5 size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
        <div>
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
            {meta.label} <Badge tone={s.tone}>{s.label}</Badge>
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">{meta.hint}</p>
          {document && (
            <button
              type="button"
              className="mt-1 text-xs font-medium text-brand-700 hover:underline"
              onClick={() => openDocument(document.id).catch((e) => toast.error('Could not open', e.message))}
            >
              View {document.filename}
            </button>
          )}
          {document?.status === 'REJECTED' && <p className="mt-1 text-xs font-medium text-danger">Reason: {document.rejectionReason}</p>}
        </div>
      </div>
      {!disabled && status !== 'ACCEPTED' && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            className="sr-only"
            aria-label={`Upload ${meta.label}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
          <Button
            variant={status === 'MISSING' || status === 'REJECTED' ? 'primary' : 'secondary'}
            size="sm"
            loading={upload.isPending}
            onClick={() => input.current?.click()}
          >
            <Upload className="size-4" aria-hidden="true" />
            {status === 'MISSING' ? 'Upload' : 'Replace'}
          </Button>
        </>
      )}
    </li>
  );
}

export function DocumentsSection({ completion, documents, disabled }) {
  return (
    <div>
      <p className="text-sm text-ink-muted">
        JPEG, PNG or PDF, up to 10 MB each. Files are encrypted and only visible to you and our compliance team.
      </p>
      <ul className="divide-y divide-border">
        {Object.entries(completion.requiredDocuments).map(([type, status]) => (
          <DocumentRow key={type} type={type} status={status} document={documents.find((d) => d.type === type)} disabled={disabled} />
        ))}
      </ul>
    </div>
  );
}
