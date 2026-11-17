import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { DOCUMENT_KINDS } from '../../features/portfolio/labels.js';
import { downloadDocument, useGenerateDocument } from '../../features/statements/useDocuments.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

function Generator() {
  const generate = useGenerateDocument();
  const thisYear = new Date().getUTCFullYear();
  const [form, setForm] = useState({
    kind: 'ACCOUNT_STATEMENT',
    format: 'PDF',
    from: monthStart(),
    to: today(),
    asOf: today(),
    year: String(thisYear - 1),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const period = !['PORTFOLIO_STATEMENT', 'TAX_STATEMENT'].includes(form.kind);
  const fieldError = (path) => generate.error?.details?.find((d) => d.path === path)?.message;

  return (
    <Card className="mb-6">
      <CardHeader
        title="Create a statement"
        description="Built from your ledger records at the moment you ask. Each file is kept, so you can download it again."
      />
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            generate.mutate(
              form.kind === 'TAX_STATEMENT'
                ? { kind: form.kind, format: form.format, year: Number(form.year) }
                : period
                  ? { kind: form.kind, format: form.format, from: form.from, to: form.to }
                  : { kind: form.kind, format: form.format, asOf: form.asOf },
            );
          }}
        >
          <Field label="Document">
            {(p) => (
              <Select
                value={form.kind}
                onChange={set('kind')}
                options={['ACCOUNT_STATEMENT', 'PORTFOLIO_STATEMENT', 'TRANSACTION_REPORT', 'TAX_STATEMENT'].map((k) => ({
                  value: k,
                  label: DOCUMENT_KINDS[k],
                }))}
                {...p}
              />
            )}
          </Field>
          {form.kind === 'TAX_STATEMENT' ? (
            <Field label="Tax year" error={fieldError('year')} className="lg:col-span-2">
              {(p) => (
                <Select
                  value={form.year}
                  onChange={set('year')}
                  options={[0, 1, 2, 3].map((n) => ({
                    value: String(thisYear - n),
                    label: n === 0 ? `${thisYear} (year to date)` : String(thisYear - n),
                  }))}
                  {...p}
                />
              )}
            </Field>
          ) : period ? (
            <>
              <Field label="From" error={fieldError('from')}>
                {(p) => <Input type="date" value={form.from} max={form.to} onChange={set('from')} {...p} />}
              </Field>
              <Field label="To" error={fieldError('to')}>
                {(p) => <Input type="date" value={form.to} max={today()} onChange={set('to')} {...p} />}
              </Field>
            </>
          ) : (
            <Field label="As of (end of day)" error={fieldError('asOf')} className="lg:col-span-2">
              {(p) => <Input type="date" value={form.asOf} max={today()} onChange={set('asOf')} {...p} />}
            </Field>
          )}
          <Field label="Format">
            {(p) => (
              <Select
                value={form.format}
                onChange={set('format')}
                options={[
                  { value: 'PDF', label: 'PDF' },
                  { value: 'CSV', label: 'CSV (spreadsheet)' },
                ]}
                {...p}
              />
            )}
          </Field>
          <Button type="submit" loading={generate.isPending}>
            <Download className="size-4" aria-hidden="true" /> Create and download
          </Button>
        </form>
        <p className="mt-3 text-xs text-ink-subtle">
          Receipts and investment confirmations are on the{' '}
          <Link to="/app/transactions" className="underline">
            Transactions
          </Link>{' '}
          and{' '}
          <Link to="/app/investments" className="underline">
            Portfolio
          </Link>{' '}
          pages. Identity documents you uploaded are on the{' '}
          <Link to="/app/verification" className="underline">
            Verification
          </Link>{' '}
          page.
        </p>
      </CardBody>
    </Card>
  );
}

export default function StatementsPage() {
  usePageMeta({ title: 'Documents · Mynx' });
  const toast = useToast();
  const list = useQuery({ queryKey: ['statements'], queryFn: () => api.get('/statements?pageSize=50') });
  const download = useMutation({ mutationFn: downloadDocument, onError: (e) => toast.error('Download failed', e.message) });

  return (
    <>
      <PageHeader
        title="Documents"
        description="Statements, reports, receipts and confirmations. Download links are private and expire after a few minutes."
      />
      <Alert tone="warning" className="mb-6">
        Sandbox: documents are generated from simulated transactions and are not regulated statements.
      </Alert>
      <Generator />
      {list.isPending && <Skeleton className="h-40" />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Your documents"
            rows={list.data.data}
            empty={<EmptyState icon={FileText} title="No documents yet" description="Statements you create appear here." />}
            columns={[
              { key: 'title', header: 'Document', render: (d) => <span className="font-medium text-ink">{d.title}</span> },
              { key: 'kind', header: 'Type', render: (d) => DOCUMENT_KINDS[d.kind] },
              {
                key: 'format',
                header: 'Format',
                render: (d) => (
                  <Badge tone="neutral" dot={false}>
                    {d.format}
                  </Badge>
                ),
              },
              { key: 'createdAt', header: 'Created', render: (d) => formatDateTime(d.createdAt) },
              { key: 'size', header: 'Size', align: 'right', render: (d) => kb(d.sizeBytes) },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                render: (d) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={download.isPending && download.variables === d.id}
                    onClick={() => download.mutate(d.id)}
                  >
                    <Download className="size-4" aria-hidden="true" /> Download
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}
    </>
  );
}
