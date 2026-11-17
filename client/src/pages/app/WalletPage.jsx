import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowDownLeft, ArrowUpRight, Lock, ReceiptText, Wallet } from 'lucide-react';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  StatCard,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

export const ENTRY_TYPES = {
  ADJUSTMENT: 'Adjustment',
  RESERVATION: 'Reserved',
  RELEASE: 'Released',
  REVERSAL: 'Reversal',
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
};

/** Balances and activity come straight from the ledger. Nothing here is calculated in the browser. */
export default function WalletPage() {
  usePageMeta({ title: 'Wallet · Mynx' });
  const money = useMoney();
  const [page, setPage] = useState(1);
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: () => api.get('/wallet').then((r) => r.data) });
  const activity = useQuery({
    queryKey: ['wallet', 'activity', page],
    queryFn: () => api.get(`/wallet/activity?page=${page}&pageSize=20`),
    placeholderData: keepPreviousData,
  });

  if (wallet.isPending) return <Skeleton className="h-64" />;
  if (wallet.isError) return <ErrorState error={wallet.error} onRetry={wallet.refetch} />;

  return (
    <>
      <PageHeader
        title="Wallet"
        description="Your balances are held in a ledger that records every movement. Reserved money is set aside for orders in progress."
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
            <Link
              to="/app/convert"
              className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm font-medium text-ink hover:bg-surface-muted"
            >
              Convert
            </Link>
          </>
        }
      />
      <Alert tone="warning" className="mb-6">
        Sandbox: deposits and withdrawals go through a simulated payment provider. Balances have no monetary value and no real money moves.
      </Alert>
      {wallet.data.wallets.map((w) => (
        <section key={w.currency} className="mb-8" aria-label={`${w.currency} wallet`}>
          {w.status === 'FROZEN' && (
            <Alert tone="danger" title="This wallet is frozen" className="mb-4">
              Payments and new investments are paused. Contact support for help.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={`Available (${w.currency})`} value={money(w.available)} hint="Ready to invest or withdraw" icon={Wallet} />
            <StatCard label="Reserved" value={money(w.reserved)} hint="Held for orders being processed" icon={Lock} />
            <StatCard label="Total" value={money(w.total)} hint="Available + reserved" icon={ReceiptText} />
          </div>
        </section>
      ))}

      <Card>
        <CardHeader title="Activity" description="Every movement on your wallet, newest first." />
        {activity.isPending && <Skeleton className="m-5 h-32" />}
        {activity.isError && <ErrorState error={activity.error} onRetry={activity.refetch} />}
        {activity.data && (
          <>
            <DataTable
              caption="Wallet activity"
              rows={activity.data.data}
              empty={<EmptyState icon={ReceiptText} title="No activity yet" description="Movements on your wallet appear here." />}
              columns={[
                { key: 'postedAt', header: 'Date', render: (a) => formatDateTime(a.postedAt) },
                {
                  key: 'description',
                  header: 'Description',
                  render: (a) => (
                    <span className="flex items-start gap-2">
                      {a.amount.amountMinor.startsWith('-') ? (
                        <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-label="Out" />
                      ) : (
                        <ArrowDownLeft className="mt-0.5 size-4 shrink-0 text-success" aria-label="In" />
                      )}
                      <span>
                        <span className="block text-ink">{a.description}</span>
                        <span className="text-xs text-ink-subtle">
                          {ENTRY_TYPES[a.type] ?? a.type} · {a.bucket} · ref #{a.entryNumber}
                        </span>
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'bucket',
                  header: 'Balance',
                  render: (a) => <Badge tone={a.bucket === 'available' ? 'success' : 'info'}>{a.bucket}</Badge>,
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  align: 'right',
                  render: (a) => (
                    <span className={a.amount.amountMinor.startsWith('-') ? 'text-ink' : 'text-success'}>
                      {a.amount.amountMinor.startsWith('-') ? money(a.amount) : `+${money(a.amount)}`}
                    </span>
                  ),
                },
              ]}
            />
            {activity.data.meta.total > 20 && (
              <Pagination page={page} pageSize={20} total={activity.data.meta.total} onPageChange={setPage} />
            )}
          </>
        )}
      </Card>
    </>
  );
}
