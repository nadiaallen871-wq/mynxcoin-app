import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Modal,
  Skeleton,
  Textarea,
} from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../auth/useSession.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useMoney } from '../investments/shared.jsx';
import { formatDateTime } from '../../utils/format.js';

/** Staff view of a user's wallet (wallet:read:any), with freeze/unfreeze for compliance (compliance:cases:manage). */
export function UserWalletCard({ userId }) {
  const { data: session } = useSession();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [freezing, setFreezing] = useState(null);
  const [reason, setReason] = useState('');
  const wallet = useQuery({
    queryKey: ['admin', 'wallets', userId],
    queryFn: () => api.get(`/admin/wallets/${userId}?pageSize=5`).then((r) => r.data),
  });
  const setStatus = useMutation({
    mutationFn: ({ currency, frozen }) => api.post(`/admin/wallets/${userId}/status`, { currency, frozen, ...(frozen ? { reason } : {}) }),
    onSuccess: (_r, v) => {
      toast.success(v.frozen ? 'Wallet frozen' : 'Wallet unfrozen');
      setFreezing(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['admin', 'wallets', userId] });
    },
  });
  const canFreeze = hasPermission(session, 'compliance:cases:manage');

  return (
    <Card>
      <CardHeader title="Wallet" description="Derived from the ledger." />
      <CardBody className="space-y-4 text-sm">
        {wallet.isPending && <Skeleton className="h-20" />}
        {wallet.isError && <ErrorState error={wallet.error} onRetry={wallet.refetch} />}
        {wallet.data?.wallets.map((w) => (
          <div key={w.currency} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">{w.currency}</span>
              <Badge tone={w.status === 'FROZEN' ? 'danger' : 'success'}>{w.status.toLowerCase()}</Badge>
            </div>
            <dl className="grid grid-cols-3 gap-2">
              {['available', 'reserved', 'total'].map((k) => (
                <div key={k}>
                  <dt className="text-xs text-ink-subtle capitalize">{k}</dt>
                  <dd className="tabular font-medium text-ink">{money(w[k])}</dd>
                </div>
              ))}
            </dl>
            {w.statusReason && <p className="text-xs text-ink-muted">Reason: {w.statusReason}</p>}
            {canFreeze && (
              <Button
                size="sm"
                variant={w.status === 'FROZEN' ? 'secondary' : 'danger'}
                onClick={() =>
                  w.status === 'FROZEN' ? setStatus.mutate({ currency: w.currency, frozen: false }) : setFreezing(w.currency)
                }
              >
                {w.status === 'FROZEN' ? 'Unfreeze wallet' : 'Freeze wallet'}
              </Button>
            )}
          </div>
        ))}
        {wallet.data?.activity.data.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">Recent activity</p>
            <ul className="mt-2 space-y-1.5 text-xs">
              {wallet.data.activity.data.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span className="truncate text-ink-muted" title={a.description}>
                    {formatDateTime(a.postedAt)} · {a.description}
                  </span>
                  <span className="tabular shrink-0 text-ink">{money(a.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
      <Modal
        open={Boolean(freezing)}
        onClose={() => setFreezing(null)}
        title="Freeze wallet"
        description="New reservations, orders and withdrawals will be blocked until it is unfrozen."
        footer={
          <>
            <Button variant="secondary" onClick={() => setFreezing(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 10}
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate({ currency: freezing, frozen: true })}
            >
              Freeze
            </Button>
          </>
        }
      >
        {setStatus.error && (
          <Alert tone="danger" className="mb-3">
            {setStatus.error.message}
          </Alert>
        )}
        <Field label="Reason (audit log)" hint="At least 10 characters." required>
          {(p) => <Textarea value={reason} onChange={(e) => setReason(e.target.value)} {...p} />}
        </Field>
      </Modal>
    </Card>
  );
}
