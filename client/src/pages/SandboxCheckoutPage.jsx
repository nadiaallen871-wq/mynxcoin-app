import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { Alert, Button, ErrorState, Skeleton } from '../components/ui/index.js';
import { api } from '../services/api.js';
import { useMoney } from '../features/investments/shared.jsx';
import { usePageMeta } from '../hooks/usePageMeta.js';

/**
 * Stand-in for a payment provider's hosted checkout (sandbox only). Choosing an
 * outcome makes the sandbox provider send a signed webhook to the API, which
 * re-verifies with the provider before crediting, exactly as with a real provider.
 */
export default function SandboxCheckoutPage() {
  const { reference } = useParams();
  const navigate = useNavigate();
  const money = useMoney();
  usePageMeta({ title: 'Sandbox checkout' });
  const info = useQuery({
    queryKey: ['sandbox-checkout', reference],
    queryFn: () => api.get(`/payments/sandbox/${reference}`).then((r) => r.data),
    retry: false,
  });
  const complete = useMutation({
    mutationFn: (outcome) => api.post(`/payments/sandbox/${reference}/complete`, { outcome }),
    onSuccess: (res) => navigate(`/app/deposits/${res.data.id}`, { replace: true }),
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm rounded-card border-2 border-dashed border-warning bg-surface p-6 shadow-card">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-warning uppercase">
          <FlaskConical className="size-4" aria-hidden="true" /> Sandbox payment provider
        </p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Simulated checkout</h1>
        {info.isPending && <Skeleton className="mt-4 h-24" />}
        {info.isError && <ErrorState error={info.error} />}
        {info.data && (
          <>
            <p className="tabular mt-4 text-3xl font-semibold text-ink">{money(info.data.amount)}</p>
            <p className="mt-1 font-mono text-xs text-ink-subtle">{reference}</p>
            {info.data.status !== 'PENDING' ? (
              <Alert tone="info" className="mt-4">
                This checkout is already complete.
              </Alert>
            ) : (
              <div className="mt-6 space-y-2">
                {complete.error && <Alert tone="danger">{complete.error.message}</Alert>}
                <Button
                  className="w-full"
                  variant="accent"
                  loading={complete.isPending && complete.variables === 'success'}
                  onClick={() => complete.mutate('success')}
                >
                  Simulate successful payment
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  loading={complete.isPending && complete.variables === 'failure'}
                  onClick={() => complete.mutate('failure')}
                >
                  Simulate failed payment
                </Button>
                <Button className="w-full" variant="ghost" onClick={() => navigate(`/app/deposits/${info.data.depositId}`)}>
                  Leave without paying
                </Button>
              </div>
            )}
            <p className="mt-6 text-xs text-ink-subtle">
              No real money moves. In live mode, this step happens on the payment provider’s own secure page.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
