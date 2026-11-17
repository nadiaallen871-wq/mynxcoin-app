import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, ErrorState, Field, Input, Skeleton } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api, ApiError } from '../../services/api.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { DEPOSIT_STATUS, newIdempotencyKey } from '../../features/payments/status.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

/** Starts a deposit and hands the investor to the provider's hosted checkout. */
export default function DepositPage() {
  usePageMeta({ title: 'Deposit · Mynx' });
  const [amount, setAmount] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const start = useMutation({
    mutationFn: () =>
      api.post('/wallet/deposits', { amount: amount.replace(/,/g, ''), currency: 'GHS' }, { headers: { 'Idempotency-Key': key } }),
    onSuccess: (res) => {
      setKey(newIdempotencyKey());
      window.location.assign(res.data.checkoutUrl);
    },
  });
  const err = start.error;
  return (
    <>
      <PageHeader title="Deposit" description="Add money to your wallet through our payment provider." />
      <Card className="max-w-lg">
        <CardBody>
          <Alert tone="warning" className="mb-4">
            Sandbox: you will be taken to a simulated checkout. No real money is charged.
          </Alert>
          {err?.code === 'KYC_REQUIRED' ? (
            <Alert tone="info" title="Verify your identity first">
              <Link to="/app/verification" className="font-medium text-brand-700 underline">
                Complete verification
              </Link>{' '}
              to deposit.
            </Alert>
          ) : (
            err &&
            !err.details && (
              <Alert tone="danger" className="mb-4">
                {err.message}
              </Alert>
            )
          )}
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <Field
              label="Amount (GHS)"
              hint="Between GH₵ 10.00 and GH₵ 50,000.00"
              error={err?.details?.find((d) => d.path === 'amount')?.message}
              required
            >
              {(p) => (
                <Input
                  inputMode="decimal"
                  placeholder="500.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                  {...p}
                />
              )}
            </Field>
            <p className="text-xs text-ink-subtle">Provider fees are covered by Mynx. The full amount you pay is added to your wallet.</p>
            <Button type="submit" className="w-full" disabled={!amount} loading={start.isPending}>
              Continue to payment
            </Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

const FINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'REVERSED'];

/** Return page after checkout. It polls the server, which re-verifies with the provider. The redirect itself proves nothing. */
export function DepositStatusPage() {
  const { id } = useParams();
  const money = useMoney();
  const qc = useQueryClient();
  usePageMeta({ title: 'Deposit status · Mynx' });
  const deposit = useQuery({
    queryKey: ['deposit', id],
    queryFn: () => api.get(`/wallet/deposits/${id}?refresh=1`).then((r) => r.data),
    refetchInterval: (q) => (q.state.data && FINAL.includes(q.state.data.status) ? false : 3000),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 3,
  });
  const status = deposit.data?.status;
  useEffect(() => {
    if (status === 'SUCCEEDED') qc.invalidateQueries({ queryKey: ['wallet'] });
  }, [status, qc]);

  if (deposit.isPending) return <Skeleton className="h-48 max-w-lg" />;
  if (deposit.isError) return <ErrorState error={deposit.error} onRetry={deposit.refetch} />;
  const d = deposit.data;
  const Icon = d.status === 'SUCCEEDED' ? CheckCircle2 : FINAL.includes(d.status) ? XCircle : Clock;
  return (
    <>
      <PageHeader title="Deposit" />
      <Card className="max-w-lg">
        <CardBody className="flex flex-col items-center py-8 text-center" aria-live="polite">
          <Icon
            className={`size-10 ${d.status === 'SUCCEEDED' ? 'text-success' : FINAL.includes(d.status) ? 'text-danger' : 'animate-pulse text-warning'}`}
            aria-hidden="true"
          />
          <p className="tabular mt-3 text-2xl font-semibold text-ink">{money(d.amount)}</p>
          <Badge tone={DEPOSIT_STATUS[d.status].tone} className="mt-2">
            {DEPOSIT_STATUS[d.status].label}
          </Badge>
          <p className="mt-4 text-sm text-ink-muted">
            {d.status === 'SUCCEEDED'
              ? 'The money is in your available balance.'
              : d.status === 'PENDING'
                ? 'We are waiting for the payment provider to confirm. This page updates automatically.'
                : (d.failureReason ?? 'The payment was not completed. No money was taken.')}
          </p>
          <p className="mt-1 font-mono text-xs text-ink-subtle">Ref {d.reference}</p>
          <div className="mt-6 flex gap-2">
            {d.status === 'PENDING' && d.checkoutUrl && (
              <Button variant="secondary" onClick={() => window.location.assign(d.checkoutUrl)}>
                Return to checkout
              </Button>
            )}
            <Link
              to="/app/wallet"
              className="inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800"
            >
              Go to wallet
            </Link>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
