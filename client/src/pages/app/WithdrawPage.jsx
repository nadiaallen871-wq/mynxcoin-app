import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, CardBody, ConfirmDialog, Field, Input, Select, Skeleton } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api, applyServerErrors } from '../../services/api.js';
import { useSession, displayName } from '../../features/auth/useSession.js';
import { useMoney } from '../../features/investments/shared.jsx';
import { BANKS, MOMO_NETWORKS, newIdempotencyKey } from '../../features/payments/status.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePageMeta } from '../../hooks/usePageMeta.js';

export default function WithdrawPage() {
  usePageMeta({ title: 'Withdraw · Mynx' });
  const money = useMoney();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: () => api.get('/wallet').then((r) => r.data) });
  const [method, setMethod] = useState('MOBILE_MONEY');
  const [form, setForm] = useState({ amount: '', network: 'MTN', bankCode: 'GCB', accountNumber: '', accountName: displayName(session) });
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = useMutation({
    mutationFn: () =>
      api.post(
        '/wallet/withdrawals',
        {
          amount: form.amount.replace(/,/g, ''),
          currency: 'GHS',
          method,
          destination:
            method === 'MOBILE_MONEY'
              ? { network: form.network, accountNumber: form.accountNumber, accountName: form.accountName }
              : { bankCode: form.bankCode, accountNumber: form.accountNumber, accountName: form.accountName },
        },
        { headers: { 'Idempotency-Key': key } },
      ),
    onSuccess: () => {
      setKey(newIdempotencyKey());
      qc.invalidateQueries({ queryKey: ['wallet'] });
      toast.success('Withdrawal requested', 'The amount is set aside while we review your request.');
      navigate('/app/transactions?tab=withdrawals');
    },
    onError: (err) => {
      setConfirming(false);
      const e = {};
      applyServerErrors(err, (path, v) => (e[path.split('.').pop()] = v.message));
      setErrors(e);
    },
  });

  if (wallet.isPending) return <Skeleton className="h-64 max-w-lg" />;
  const w = wallet.data?.wallets.find((x) => x.currency === 'GHS');

  return (
    <>
      <PageHeader title="Withdraw" description="Send money from your wallet to your own mobile money or bank account." />
      <Card className="max-w-lg">
        <CardBody>
          {w && (
            <p className="mb-4 text-sm text-ink-muted">
              Available to withdraw: <span className="tabular font-semibold text-ink">{money(w.available)}</span>
            </p>
          )}
          {submit.error?.code === 'KYC_REQUIRED' && (
            <Alert tone="info" className="mb-4">
              <Link to="/app/verification" className="font-medium text-brand-700 underline">
                Complete verification
              </Link>{' '}
              to withdraw.
            </Alert>
          )}
          {submit.error && !submit.error.details && submit.error.code !== 'KYC_REQUIRED' && (
            <Alert tone="danger" className="mb-4">
              {submit.error.message}
            </Alert>
          )}
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              setConfirming(true);
            }}
          >
            <Field label="Amount (GHS)" error={errors.amount} required>
              {(p) => <Input inputMode="decimal" value={form.amount} onChange={set('amount')} {...p} />}
            </Field>
            <Field label="Send to" required>
              {(p) => (
                <Select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  options={[
                    { value: 'MOBILE_MONEY', label: 'Mobile money' },
                    { value: 'BANK_ACCOUNT', label: 'Bank account' },
                  ]}
                  {...p}
                />
              )}
            </Field>
            {method === 'MOBILE_MONEY' ? (
              <Field label="Network" required>
                {(p) => <Select value={form.network} onChange={set('network')} options={MOMO_NETWORKS} {...p} />}
              </Field>
            ) : (
              <Field label="Bank" required>
                {(p) => <Select value={form.bankCode} onChange={set('bankCode')} options={BANKS} {...p} />}
              </Field>
            )}
            <Field
              label={method === 'MOBILE_MONEY' ? 'Mobile number' : 'Account number'}
              hint={method === 'MOBILE_MONEY' ? 'e.g. 0241234567' : undefined}
              error={errors.accountNumber}
              required
            >
              {(p) => (
                <Input
                  inputMode="numeric"
                  value={form.accountNumber}
                  onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '') }))}
                  {...p}
                />
              )}
            </Field>
            <Field
              label="Account name"
              hint="Must match your verified name. Payouts to third parties are not allowed."
              error={errors.accountName}
              required
            >
              {(p) => <Input value={form.accountName} onChange={set('accountName')} {...p} />}
            </Field>
            <Button type="submit" className="w-full" disabled={!form.amount || !form.accountNumber}>
              Review withdrawal
            </Button>
          </form>
        </CardBody>
      </Card>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => submit.mutate()}
        loading={submit.isPending}
        title="Confirm withdrawal"
        confirmLabel="Request withdrawal"
      >
        Withdraw <strong>GH₵ {form.amount}</strong> to{' '}
        {method === 'MOBILE_MONEY' ? `${form.network} ${form.accountNumber}` : `${form.bankCode} ${form.accountNumber}`} ({form.accountName}
        ). The amount leaves your available balance now and is sent after our team approves it.
      </ConfirmDialog>
    </>
  );
}
