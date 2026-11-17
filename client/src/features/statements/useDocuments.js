import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, BASE } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';

/** Asks for a short-lived signed link and lets the browser download the file. */
export async function downloadDocument(id) {
  const { url } = (await api.get(`/statements/${id}/download-url`)).data;
  window.location.assign(`${BASE}${url}`);
}

/** Generates a document on the server (stored and versioned), then downloads it. */
export function useGenerateDocument() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (body) => {
      const doc = (await api.post('/statements', body)).data;
      await downloadDocument(doc.id);
      return doc;
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ['statements'] });
      toast.success('Document ready', `${doc.title} is downloading and is saved in Documents.`);
    },
    onError: (e) => toast.error('Could not create the document', e.message),
  });
}
