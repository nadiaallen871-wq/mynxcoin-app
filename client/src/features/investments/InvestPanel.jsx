import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Field, Input, Modal } from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { RISK_PROFILES } from '../kyc/labels.js';
import { newIdempotencyKey } from '../payments/status.js';
import { useMoney } from './shared.jsx';

/**
 * Order form shown when the investor is eligible. The confirmation step restates the terms.
 * The server re-checks every rule and computes the fee. Nothing here decides money.
 */
export function InvestPanel({ product, eligibility }) {
  const money = useMoney();
  const toast = useToast();
  const navigate = useNavigate();
  const [amount, setAmount] = useState(product.minInvestment.decimal);
  const [accepted, setAccepted] = useState(false);
  const [ackUnsuitable, setAckUnsuitable] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: () => api.get('/wallet').then((r) => r.data) });
  const unsuitable = eligibility.suitability && !eligibility.suitability.suitable;
  const balance = wallet.data?.wallets.find((w) => w.currency === product.currency)?.available;

  const place = useMutation({
    mutationFn: () =>
      api.post(
        '/investments/orders',
        {
          productSlug: product.slug,
          amount: amount.replace(/,/g, ''),
          acceptRiskDisclosure: true,
          ...(unsuitable ? { acknowledgeUnsuitable: ackUnsuitable } : {}),
        },
        { headers: { 'Idempotency-Key': key } },
      ),
    onSuccess: () => {
      setKey(newIdempotencyKey());
      toast.success('Order placed', 'The amount is reserved in your wallet until your investment is confirmed.');
      navigate('/app/investments');
    },
    onError: () => setConfirming(false),
  });
  const fieldErr = place.error?.details?.find((d) => d.path === 'amount')?.message;

  return (
    <div className="space-y-4 text-sm">
      {balance && (
        <p className="text-ink-muted">
          Available in your wallet: <span className="tabular font-semibold text-ink">{money(balance)}</span>
        </p>
      )}
      <Field
        label={`Amount (${product.currency})`}
        hint={`Minimum ${money(product.minInvestment)}${product.maxInvestment ? ` · maximum ${money(product.maxInvestment)}` : ''}`}
        error={fieldErr}
      >
        {(p) => <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} {...p} />}
      </Field>
      {Number(product.fees.entryPercent) > 0 && (
        <p className="text-xs text-ink-subtle">An entry fee of {product.fees.entryPercent}% is deducted from the amount invested.</p>
      )}
      <label className="flex items-start gap-2 text-ink-muted">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-brand-600"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span>I have read the risks, fees and documents for this investment and understand I could lose money.</span>
      </label>
      {unsuitable && (
        <label className="flex items-start gap-2 rounded-md bg-warning-soft p-2 text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-brand-600"
            checked={ackUnsuitable}
            onChange={(e) => setAckUnsuitable(e.target.checked)}
          />
          <span>
            I understand this product is designed for a <strong>{RISK_PROFILES[eligibility.suitability.productMinimum]}</strong> risk
            profile, which is higher than mine, and I still want to invest.
          </span>
        </label>
      )}
      {place.error && !fieldErr && <Alert tone="danger">{place.error.message}</Alert>}
      <Button
        className="w-full"
        variant="accent"
        disabled={!amount || !accepted || (unsuitable && !ackUnsuitable)}
        onClick={() => setConfirming(true)}
      >
        Review order
      </Button>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm your investment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button variant="accent" loading={place.isPending} onClick={() => place.mutate()}>
              Place order
            </Button>
          </>
        }
      >
        <dl className="space-y-2 text-sm">
          {[
            ['Investment', product.name],
            ['Amount', `${product.currency} ${amount}`],
            ['Entry fee', `${product.fees.entryPercent}% of the amount`],
            ['Term', product.termDays ? `${product.termDays} days` : 'Open-ended'],
            [
              'Return',
              product.annualRatePercent
                ? `${product.annualRatePercent}% p.a. (${product.returnType === 'FIXED' ? 'fixed' : 'target, not guaranteed'})`
                : 'Variable',
            ],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-ink-subtle">{k}</dt>
              <dd className="text-right font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-ink-muted">
          The amount is reserved in your wallet now. It is invested once our team confirms the allocation, and you can cancel until then.
        </p>
      </Modal>
    </div>
  );
}
