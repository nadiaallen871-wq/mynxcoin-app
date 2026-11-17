import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Calculator as CalcIcon } from 'lucide-react';
import { Alert, Button, Field, Input } from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { useMoney } from './shared.jsx';

/**
 * Illustrative projection. The server does all the arithmetic. The browser
 * only collects inputs and formats the result.
 * With a `product`, its terms (rate, term, fees, limits) are used. Without one, the visitor enters custom terms.
 */
export function ProjectionCalculator({ product }) {
  const money = useMoney();
  const [amount, setAmount] = useState(product ? product.minInvestment.decimal : '1000');
  const [days, setDays] = useState(product?.termDays ? String(product.termDays) : '365');
  const [rate, setRate] = useState('');
  const [entryFee, setEntryFee] = useState('0');
  const [mgmtFee, setMgmtFee] = useState('0');
  const calc = useMutation({
    mutationFn: () =>
      api.post(
        '/investments/calculator',
        product
          ? { slug: product.slug, amount: amount.replace(/,/g, ''), ...(product.termDays ? {} : { days: Number(days) }) }
          : {
              amount: amount.replace(/,/g, ''),
              days: Number(days),
              ...(rate ? { annualRatePercent: rate } : {}),
              entryFeePercent: entryFee || '0',
              managementFeePercent: mgmtFee || '0',
            },
      ),
  });
  const r = calc.data?.data;
  const fieldErr = (path) => calc.error?.details?.find((d) => d.path === path)?.message;

  return (
    <div>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          calc.mutate();
        }}
      >
        <Field label={`Amount (${product?.currency ?? 'GHS'})`} error={fieldErr('amount')} required>
          {(p) => <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} {...p} />}
        </Field>
        {(!product || !product.termDays) && (
          <Field label="Period (days)" error={fieldErr('days')} required>
            {(p) => <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} {...p} />}
          </Field>
        )}
        {!product && (
          <>
            <Field label="Annual rate (%)" hint="Leave blank for a fee-only illustration" error={fieldErr('annualRatePercent')}>
              {(p) => <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} {...p} />}
            </Field>
            <Field label="Entry fee (%)" error={fieldErr('entryFeePercent')}>
              {(p) => (
                <Input inputMode="decimal" value={entryFee} onChange={(e) => setEntryFee(e.target.value.replace(/[^\d.]/g, ''))} {...p} />
              )}
            </Field>
            <Field label="Annual management fee (%)" error={fieldErr('managementFeePercent')}>
              {(p) => (
                <Input inputMode="decimal" value={mgmtFee} onChange={(e) => setMgmtFee(e.target.value.replace(/[^\d.]/g, ''))} {...p} />
              )}
            </Field>
          </>
        )}
        <div className="flex items-end sm:col-span-2">
          <Button type="submit" variant="secondary" loading={calc.isPending}>
            <CalcIcon className="size-4" aria-hidden="true" /> Calculate
          </Button>
        </div>
      </form>

      {calc.error && !calc.error.details && (
        <Alert tone="danger" className="mt-4">
          {calc.error.message}
        </Alert>
      )}

      {r && (
        <div className="mt-6 rounded-lg border border-border" aria-live="polite">
          <dl className="divide-y divide-border text-sm">
            {[
              ['You invest', r.amount],
              ['Entry fee', r.entryFee, true],
              ['Amount invested', r.invested],
              [`Return over ${r.days} days`, r.grossReturn],
              ['Management fees', r.managementFee, true],
            ].map(([label, value, negative]) => (
              <div key={label} className="flex justify-between px-4 py-2.5">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="tabular font-medium text-ink">
                  {negative && value.amountMinor !== '0' ? '−' : ''}
                  {money(value)}
                </dd>
              </div>
            ))}
            <div className="flex justify-between bg-surface-muted px-4 py-3">
              <dt className="font-semibold text-ink">Illustrative value at the end</dt>
              <dd className="tabular font-semibold text-ink">{money(r.endValue)}</dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-ink-muted">Net gain or loss</dt>
              <dd className={`tabular font-medium ${r.netGain.amountMinor.startsWith('-') ? 'text-danger' : 'text-success'}`}>
                {money(r.netGain)}
              </dd>
            </div>
          </dl>
          <div className="border-t border-border px-4 py-3 text-xs text-ink-muted">
            <p className="font-medium text-ink">Illustration only: not a promise of returns.</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {r.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
              <li>Method: {r.basis}.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
