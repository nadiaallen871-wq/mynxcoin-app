import { useSearchParams, Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Skeleton, Tabs } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { DEPOSIT_STATUS, WITHDRAWAL_STATUS } from '../../features/payments/status.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useGenerateDocument } from '../../features/statements/useDocuments.js';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

function Deposits() {
  const money = useMoney();
  const receipt = useGenerateDocument();
  const list = useQuery({ queryKey: ['wallet', 'deposits'], queryFn: () => api.get('/wallet/deposits?pageSize=50') });
  if (list.isPending) return <Skeleton className="h-40" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  return (
    <Card>
      <DataTable
        caption="Deposits"
        rows={list.data.data}
        empty={
          <EmptyState
            icon={ReceiptText}
            title="No deposits yet"
            action={
              <Link to="/app/deposit" className="text-sm font-medium text-brand-700 underline">
                Make a deposit
              </Link>
            }
          />
        }
        columns={[
          { key: 'createdAt', header: 'Date', render: (d) => formatDateTime(d.createdAt) },
          {
            key: 'reference',
            header: 'Reference',
            render: (d) => (
              <Link to={`/app/deposits/${d.id}`} className="font-mono text-xs text-brand-700 underline">
                {d.reference}
              </Link>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (d) => <Badge tone={DEPOSIT_STATUS[d.status].tone}>{DEPOSIT_STATUS[d.status].label}</Badge>,
          },
          { key: 'amount', header: 'Amount', align: 'right', render: (d) => money(d.amount) },
          {
            key: 'receipt',
            header: <span className="sr-only">Receipt</span>,
            align: 'right',
            render: (d) =>
              d.status === 'SUCCEEDED' && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={receipt.isPending && receipt.variables?.referenceId === d.id}
                  onClick={() => receipt.mutate({ kind: 'DEPOSIT_RECEIPT', referenceId: d.id })}
                >
                  Receipt
                </Button>
              ),
          },
        ]}
      />
    </Card>
  );
}

function Withdrawals() {
  const money = useMoney();
  const receipt = useGenerateDocument();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['wallet', 'withdrawals'], queryFn: () => api.get('/wallet/withdrawals?pageSize=50') });
  const cancel = useMutation({
    mutationFn: (id) => api.post(`/wallet/withdrawals/${id}/cancel`),
    onSuccess: () => {
      toast.success('Withdrawal cancelled', 'The money is back in your available balance.');
      qc.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e) => toast.error('Could not cancel', e.message),
  });
  if (list.isPending) return <Skeleton className="h-40" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  return (
    <Card>
      <DataTable
        caption="Withdrawals"
        rows={list.data.data}
        empty={<EmptyState icon={ReceiptText} title="No withdrawals yet" />}
        columns={[
          { key: 'createdAt', header: 'Date', render: (w) => formatDateTime(w.createdAt) },
          { key: 'destination', header: 'To', render: (w) => <span className="text-xs">{w.destination}</span> },
          {
            key: 'status',
            header: 'Status',
            render: (w) => (
              <span>
                <Badge tone={WITHDRAWAL_STATUS[w.status].tone}>{WITHDRAWAL_STATUS[w.status].label}</Badge>
                {w.failureReason && <span className="mt-1 block text-xs text-ink-subtle">{w.failureReason}</span>}
              </span>
            ),
          },
          { key: 'amount', header: 'Amount', align: 'right', render: (w) => money(w.amount) },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (w) =>
              w.status === 'REQUESTED' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={cancel.isPending && cancel.variables === w.id}
                  onClick={() => cancel.mutate(w.id)}
                >
                  Cancel
                </Button>
              ) : (
                w.status === 'COMPLETED' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={receipt.isPending && receipt.variables?.referenceId === w.id}
                    onClick={() => receipt.mutate({ kind: 'WITHDRAWAL_RECEIPT', referenceId: w.id })}
                  >
                    Receipt
                  </Button>
                )
              ),
          },
        ]}
      />
    </Card>
  );
}

export default function TransactionsPage() {
  usePageMeta({ title: 'Transactions · Mynx' });
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'deposits';
  return (
    <>
      <PageHeader
        title="Transactions"
        description="Deposits and withdrawals. Every movement also appears in your wallet activity."
        actions={
          <>
            <Link
              to="/app/deposit"
              className="inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800"
            >
              Deposit
            </Link>
            <Link
              to="/app/withdraw"
              className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm font-medium text-ink hover:bg-surface-muted"
            >
              Withdraw
            </Link>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        tabs={[
          { value: 'deposits', label: 'Deposits', content: <Deposits /> },
          { value: 'withdrawals', label: 'Withdrawals', content: <Withdrawals /> },
        ]}
      />
    </>
  );
}
