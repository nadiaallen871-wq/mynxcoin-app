import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Repeat } from 'lucide-react';
import {
  Alert,
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
import { useMoney } from '../../features/investments/shared.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

function useCountdown(until) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) return undefined;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(until) - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

export default function ConvertPage() {
  usePageMeta({ title: 'Convert currency · Mynx' });
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const rates = useQuery({ queryKey: ['fx', 'rates'], queryFn: () => api.get('/fx/rates').then((r) => r.data) });
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: () => api.get('/wallet').then((r) => r.data) });
  const history = useQuery({ queryKey: ['fx', 'conversions'], queryFn: () => api.get('/fx/conversions?pageSize=20') });
  const [form, setForm] = useState({ from: 'GHS', to: 'USD', amount: '' });
  const [quote, setQuote] = useState(null);
  const left = useCountdown(quote?.expiresAt);

  const getQuote = useMutation({
    mutationFn: () => api.post('/fx/quotes', form).then((r) => r.data),
    onSuccess: (q) => {
      setQuote(q);
      // A quote may have refreshed the stored rate, so reload the rates card.
      qc.invalidateQueries({ queryKey: ['fx', 'rates'] });
    },
  });
  const convert = useMutation({
    mutationFn: () => api.post('/fx/conversions', { quoteId: quote.id }).then((r) => r.data),
    onSuccess: (c) => {
      toast.success('Converted', `${money(c.from)} → ${money(c.to)}`);
      setQuote(null);
      setForm((f) => ({ ...f, amount: '' }));
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['fx', 'conversions'] });
    },
    onError: () => setQuote(null),
  });

  if (rates.isPending || wallet.isPending) return <Skeleton className="h-72" />;
  if (rates.isError) return <ErrorState error={rates.error} onRetry={rates.refetch} />;
  const active = rates.data.currencies.filter((c) => c.active);
  const balanceOf = (code) => wallet.data?.wallets.find((w) => w.currency === code)?.available;
  const set = (k) => (e) => {
    setQuote(null);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };
  const amountError = getQuote.error?.details?.find((d) => d.path === 'amount')?.message;

  return (
    <>
      <PageHeader
        title="Convert currency"
        description="Move money between your own currency wallets. Each wallet keeps its own balance; nothing is added across currencies."
      />
      {rates.data.sandbox && (
        <Alert tone="warning" className="mb-6">
          Sandbox: rates are fixed illustrative values, not market rates. No real currency is exchanged.
        </Alert>
      )}
      {active.length < 2 ? (
        <Card>
          <EmptyState
            icon={ArrowRightLeft}
            title="Only one currency is available"
            description="Conversion opens when another currency wallet is enabled."
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="New conversion" />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  {(p) => (
                    <Select
                      value={form.from}
                      onChange={set('from')}
                      options={active.map((c) => ({ value: c.code, label: c.code }))}
                      {...p}
                    />
                  )}
                </Field>
                <Field label="To">
                  {(p) => (
                    <Select
                      value={form.to}
                      onChange={set('to')}
                      options={active.filter((c) => c.code !== form.from).map((c) => ({ value: c.code, label: c.code }))}
                      {...p}
                    />
                  )}
                </Field>
              </div>
              <Field
                label={`Amount (${form.from})`}
                error={amountError}
                hint={balanceOf(form.from) ? `Available: ${money(balanceOf(form.from))}` : undefined}
              >
                {(p) => <Input inputMode="decimal" value={form.amount} onChange={set('amount')} {...p} />}
              </Field>
              {getQuote.error && !amountError && <Alert tone="danger">{getQuote.error.message}</Alert>}
              {convert.error && <Alert tone="danger">{convert.error.message}</Alert>}
              {!quote || left === 0 ? (
                <Button
                  className="w-full"
                  disabled={!form.amount || form.from === form.to}
                  loading={getQuote.isPending}
                  onClick={() => getQuote.mutate()}
                >
                  {quote ? 'Quote expired: get a new quote' : 'Get quote'}
                </Button>
              ) : (
                <div className="space-y-3 rounded-lg border border-border bg-surface-muted p-4 text-sm">
                  <dl className="space-y-1">
                    {[
                      ['You convert', money(quote.from)],
                      ['Fee', `${money(quote.fee)} (${quote.spreadBps / 100}%)`],
                      ['You receive', money(quote.to)],
                      ['Rate', `1 ${quote.from.currency} = ${quote.rate} ${quote.to.currency}`],
                      ['Rate source', `${quote.rateSource}, ${formatDateTime(quote.rateAsOf)}`],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4">
                        <dt className="text-ink-subtle">{k}</dt>
                        <dd className="text-right font-medium text-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <Button className="w-full" variant="accent" loading={convert.isPending} onClick={() => convert.mutate()}>
                    Convert now ({left}s)
                  </Button>
                  <p className="text-xs text-ink-subtle">The quote is fixed for 60 seconds and can be used once.</p>
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Rates" description={`Value of one unit in ${rates.data.anchor}`} />
            <ul className="divide-y divide-border">
              {rates.data.rates.map((r) => (
                <li key={r.currency} className="flex justify-between px-5 py-3 text-sm">
                  <span className="text-ink">
                    1 {r.currency} = {r.rate} {r.anchor}
                  </span>
                  <span className="text-xs text-ink-subtle">
                    {r.source} · {formatDateTime(r.asOf)}
                  </span>
                </li>
              ))}
              {!rates.data.rates.length && <li className="px-5 py-3 text-sm text-ink-subtle">Rates load when you ask for a quote.</li>}
            </ul>
          </Card>
        </div>
      )}
      <Card className="mt-6">
        <CardHeader title="Your conversions" />
        {history.isPending ? (
          <Skeleton className="m-5 h-20" />
        ) : (
          <DataTable
            caption="Conversion history"
            rows={history.data?.data ?? []}
            empty={<EmptyState icon={Repeat} title="No conversions yet" />}
            columns={[
              { key: 'createdAt', header: 'Date', render: (c) => formatDateTime(c.createdAt) },
              { key: 'from', header: 'Converted', align: 'right', render: (c) => money(c.from) },
              { key: 'fee', header: 'Fee', align: 'right', render: (c) => money(c.fee) },
              { key: 'to', header: 'Received', align: 'right', render: (c) => money(c.to) },
              { key: 'rate', header: 'Rate', align: 'right', render: (c) => <span className="font-mono text-xs">{c.rate}</span> },
            ]}
          />
        )}
      </Card>
    </>
  );
}
