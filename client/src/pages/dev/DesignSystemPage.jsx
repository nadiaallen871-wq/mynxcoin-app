import { useState } from 'react';
import { Wallet } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  Spinner,
  StatCard,
  Tabs,
} from '../../components/ui/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatMoney } from '../../utils/format.js';

/**
 * Development-only component catalogue. Mounted only when import.meta.env.DEV.
 * Every value here is a labelled sample for visual review, not financial data.
 */
const SAMPLE_ROWS = [
  { id: 'a', ref: 'SAMPLE-001', status: 'Completed', amountMinor: '125050' },
  { id: 'b', ref: 'SAMPLE-002', status: 'Pending', amountMinor: '-2500' },
  { id: 'c', ref: 'SAMPLE-003', status: 'Failed', amountMinor: '980000' },
];
const STATUS_TONE = { Completed: 'success', Pending: 'warning', Failed: 'danger' };

export default function DesignSystemPage() {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState('buttons');
  const [page, setPage] = useState(1);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Design system</h1>
        <p className="mt-1 text-ink-muted">Development preview of Mynx UI primitives. All figures are labelled samples.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Sample metric" value={formatMoney('12500075', 'GHS')} hint="Sample value · tabular figures" icon={Wallet} />
        <Card className="space-y-3 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-3 w-32" />
        </Card>
        <Card className="flex items-center justify-center p-5">
          <Spinner label="Loading sample" />
        </Card>
      </div>

      <Card>
        <CardHeader title="Components" description="Use the arrow keys to move between tabs" />
        <CardBody>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              {
                value: 'buttons',
                label: 'Buttons & badges',
                content: (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Button>Primary</Button>
                      <Button variant="accent">Accent</Button>
                      <Button variant="secondary">Secondary</Button>
                      <Button variant="ghost">Ghost</Button>
                      <Button variant="danger">Danger</Button>
                      <Button loading>Saving</Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge>Draft</Badge>
                      <Badge tone="success">Active</Badge>
                      <Badge tone="warning">Pending</Badge>
                      <Badge tone="danger">Rejected</Badge>
                      <Badge tone="info">Processing</Badge>
                    </div>
                  </div>
                ),
              },
              {
                value: 'forms',
                label: 'Forms',
                content: (
                  <div className="grid max-w-xl gap-4">
                    <Field label="Email address" hint="We never share your email." required>
                      {(p) => <Input type="email" placeholder="you@example.com" {...p} />}
                    </Field>
                    <Field label="Amount" error="Enter an amount of at least GH₵ 50.00">
                      {(p) => <Input inputMode="decimal" defaultValue="10" {...p} />}
                    </Field>
                    <Field label="Risk tolerance">
                      {(p) => (
                        <Select
                          placeholder="Select…"
                          options={[
                            { value: 'low', label: 'Conservative' },
                            { value: 'mid', label: 'Balanced' },
                            { value: 'high', label: 'Growth' },
                          ]}
                          {...p}
                        />
                      )}
                    </Field>
                  </div>
                ),
              },
              {
                value: 'overlays',
                label: 'Overlays & toasts',
                content: (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setModal(true)}>
                      Open modal
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirm(true)}>
                      Confirm dialog
                    </Button>
                    <Button variant="secondary" onClick={() => setDrawer(true)}>
                      Open drawer
                    </Button>
                    <Button variant="secondary" onClick={() => toast.success('Saved', 'Your changes were saved.')}>
                      Success toast
                    </Button>
                    <Button variant="secondary" onClick={() => toast.error('Request failed', 'Reference: SAMPLE-REQ')}>
                      Error toast
                    </Button>
                  </div>
                ),
              },
              {
                value: 'states',
                label: 'States',
                content: (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                      <EmptyState title="No transactions yet" description="Transactions appear here once you fund your wallet." />
                    </Card>
                    <Card>
                      <ErrorState
                        error={{ message: 'The server could not be reached.', requestId: 'sample-request-id' }}
                        onRetry={() => {}}
                      />
                    </Card>
                    <Alert tone="info" title="Information">
                      Neutral guidance for the user.
                    </Alert>
                    <Alert tone="warning" title="Sandbox">
                      Balances shown are simulated.
                    </Alert>
                  </div>
                ),
              },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Data table" description="Right-aligned tabular figures for money columns" />
        <DataTable
          caption="Sample transactions"
          rows={SAMPLE_ROWS}
          columns={[
            { key: 'ref', header: 'Reference', render: (r) => <span className="font-mono text-xs">{r.ref}</span> },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
            { key: 'amount', header: 'Amount', align: 'right', render: (r) => formatMoney(r.amountMinor, 'GHS') },
          ]}
        />
        <Pagination page={page} pageSize={3} total={9} onPageChange={setPage} />
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Sample modal"
        description="Native dialog with focus trapping"
        footer={<Button onClick={() => setModal(false)}>Done</Button>}
      >
        <p className="text-sm text-ink-muted">Press Escape or use the close button to dismiss.</p>
      </Modal>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => setConfirm(false)}
        title="Cancel sample order?"
        confirmLabel="Cancel order"
        tone="danger"
      >
        This is how irreversible actions are confirmed. The button names the action.
      </ConfirmDialog>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Sample drawer">
        <p className="text-sm text-ink-muted">Used for detail panels such as transaction details.</p>
      </Drawer>
    </div>
  );
}
