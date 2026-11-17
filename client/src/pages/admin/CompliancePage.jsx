import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Tabs,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { ALERT_RULES, ALERT_STATUS, CASE_EVENTS, CASE_PRIORITY, CASE_STATUS, CASE_TYPES, SEVERITY } from '../../features/admin/labels.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const opts = (map, label = (v) => v.label ?? v) => Object.entries(map).map(([value, v]) => ({ value, label: label(v) }));

function Alerts() {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const canManage = hasPermission(session, 'fraud:alerts:manage') && hasPermission(session, 'compliance:cases:manage');
  const [status, setStatus] = useState('OPEN');
  const [acting, setActing] = useState(null);
  const list = useQuery({
    queryKey: ['admin', 'alerts', status],
    queryFn: () => api.get(`/admin/compliance/alerts?pageSize=50${status ? `&status=${status}` : ''}`),
  });
  const act = useMutation({
    mutationFn: ({ id, kind, note, type }) =>
      api.post(`/admin/compliance/alerts/${id}/${kind}`, kind === 'escalate' ? { note, type } : { note }),
    onSuccess: (res, v) => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      setActing(null);
      if (v.kind === 'escalate') navigate(`/admin/compliance/cases/${res.data.id}`);
      else toast.success('Alert dismissed');
    },
  });
  return (
    <>
      <div className="mb-4 max-w-xs">
        <Field label="Status">
          {(p) => (
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[{ value: '', label: 'All' }, ...opts(ALERT_STATUS)]}
              {...p}
            />
          )}
        </Field>
      </div>
      {list.isPending && <Skeleton className="h-40" />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Monitoring alerts"
            rows={list.data.data}
            empty={<EmptyState icon={ShieldCheck} title="No alerts" />}
            columns={[
              { key: 'createdAt', header: 'Raised', render: (a) => formatDateTime(a.createdAt) },
              {
                key: 'severity',
                header: 'Severity',
                render: (a) => <Badge tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Badge>,
              },
              {
                key: 'rule',
                header: 'Alert',
                render: (a) => (
                  <span>
                    <span className="font-medium text-ink">{ALERT_RULES[a.rule] ?? a.rule}</span>
                    <span className="block text-xs text-ink-subtle">{a.summary}</span>
                    {a.reviewNote && <span className="block text-xs text-ink-subtle">Review: “{a.reviewNote}”</span>}
                  </span>
                ),
              },
              {
                key: 'subject',
                header: 'Person',
                render: (a) => (
                  <span>
                    {a.subject.name}
                    <span className="block text-xs text-ink-subtle">{a.subject.email}</span>
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (a) =>
                  a.caseId ? (
                    <Link to={`/admin/compliance/cases/${a.caseId}`} className="underline">
                      <Badge tone={ALERT_STATUS[a.status].tone}>{ALERT_STATUS[a.status].label}</Badge>
                    </Link>
                  ) : (
                    <Badge tone={ALERT_STATUS[a.status].tone}>{ALERT_STATUS[a.status].label}</Badge>
                  ),
              },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                render: (a) =>
                  canManage &&
                  a.status === 'OPEN' && (
                    <span className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        onClick={() =>
                          setActing({ alert: a, kind: 'escalate', note: '', type: a.rule === 'AMOUNT_MISMATCH' ? 'FRAUD' : 'AML' })
                        }
                      >
                        Open case
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setActing({ alert: a, kind: 'dismiss', note: '' })}>
                        Dismiss
                      </Button>
                    </span>
                  ),
              },
            ]}
          />
        </Card>
      )}
      {acting && (
        <Modal
          open
          onClose={() => setActing(null)}
          title={acting.kind === 'escalate' ? 'Open a compliance case' : 'Dismiss alert'}
          footer={
            <>
              <Button variant="secondary" onClick={() => setActing(null)}>
                Cancel
              </Button>
              <Button
                loading={act.isPending}
                disabled={acting.note.trim().length < 5}
                onClick={() => act.mutate({ id: acting.alert.id, kind: acting.kind, note: acting.note, type: acting.type })}
              >
                {acting.kind === 'escalate' ? 'Open case' : 'Dismiss'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {act.error && <Alert tone="danger">{act.error.message}</Alert>}
            <p className="text-sm text-ink-muted">
              {ALERT_RULES[acting.alert.rule]}: {acting.alert.summary} ({acting.alert.subject.name})
            </p>
            {acting.kind === 'escalate' && (
              <Field label="Case type">
                {(p) => (
                  <Select
                    value={acting.type}
                    onChange={(e) => setActing((x) => ({ ...x, type: e.target.value }))}
                    options={opts(CASE_TYPES)}
                    {...p}
                  />
                )}
              </Field>
            )}
            <Field label={acting.kind === 'escalate' ? 'Why this needs a case' : 'Why no action is needed (recorded)'}>
              {(p) => <Textarea rows={3} value={acting.note} onChange={(e) => setActing((x) => ({ ...x, note: e.target.value }))} {...p} />}
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function Cases() {
  const [status, setStatus] = useState('OPEN_ANY');
  const list = useQuery({
    queryKey: ['admin', 'cases', status],
    queryFn: () => api.get(`/admin/compliance/cases?pageSize=50&status=${status}`),
  });
  return (
    <>
      <div className="mb-4 max-w-xs">
        <Field label="Status">
          {(p) => (
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[{ value: 'OPEN_ANY', label: 'All open' }, ...opts(CASE_STATUS), { value: 'ALL', label: 'All' }]}
              {...p}
            />
          )}
        </Field>
      </div>
      {list.isPending && <Skeleton className="h-40" />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Compliance cases"
            rows={list.data.data}
            empty={<EmptyState icon={ShieldAlert} title="No cases" />}
            columns={[
              { key: 'number', header: 'Case', render: (c) => <span className="font-mono text-xs">#{c.number}</span> },
              {
                key: 'title',
                header: 'Title',
                render: (c) => (
                  <span>
                    <Link to={`/admin/compliance/cases/${c.id}`} className="font-medium text-ink hover:underline">
                      {c.title}
                    </Link>
                    <span className="block text-xs text-ink-subtle">
                      {CASE_TYPES[c.type]} · {c.subject.name}
                    </span>
                  </span>
                ),
              },
              {
                key: 'priority',
                header: 'Priority',
                render: (c) => <Badge tone={CASE_PRIORITY[c.priority].tone}>{CASE_PRIORITY[c.priority].label}</Badge>,
              },
              {
                key: 'status',
                header: 'Status',
                render: (c) => <Badge tone={CASE_STATUS[c.status].tone}>{CASE_STATUS[c.status].label}</Badge>,
              },
              {
                key: 'assignee',
                header: 'Assignee',
                render: (c) => c.assignee?.name ?? <span className="text-ink-subtle">Unassigned</span>,
              },
              { key: 'updatedAt', header: 'Updated', render: (c) => formatDateTime(c.updatedAt) },
            ]}
          />
        </Card>
      )}
    </>
  );
}

export default function CompliancePage() {
  usePageMeta({ title: 'Compliance · Mynx admin' });
  const { data: session } = useSession();
  const tabs = [
    ...(hasPermission(session, 'fraud:alerts:read') ? [{ value: 'alerts', label: 'Monitoring alerts', content: <Alerts /> }] : []),
    ...(hasPermission(session, 'compliance:cases:read') ? [{ value: 'cases', label: 'Cases', content: <Cases /> }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.value);
  return (
    <>
      <PageHeader
        title="Compliance"
        description="Alerts flag activity for review; they never block anything on their own. Having this workflow does not by itself make the platform compliant: rules and thresholds must be set with your compliance officer for your licence and jurisdiction."
      />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
    </>
  );
}

function ActionModal({ title, onClose, onSubmit, pending, error, disabled, label, children }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} disabled={disabled} onClick={onSubmit}>
            {label}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error.details?.[0]?.message ?? error.message}</Alert>}
        {children}
      </div>
    </Modal>
  );
}

export function ComplianceCasePage() {
  const { id } = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canManage = hasPermission(session, 'compliance:cases:manage');
  const [note, setNote] = useState('');
  const [modal, setModal] = useState(null);
  const c = useQuery({ queryKey: ['admin', 'case', id], queryFn: () => api.get(`/admin/compliance/cases/${id}`).then((r) => r.data) });
  const officers = useQuery({
    queryKey: ['admin', 'officers'],
    queryFn: () => api.get('/admin/compliance/officers').then((r) => r.data),
    enabled: canManage,
  });
  usePageMeta({ title: c.data ? `Case #${c.data.number} · Compliance` : 'Compliance' });
  const base = `/admin/compliance/cases/${id}`;
  const done = (res, message) => {
    qc.setQueryData(['admin', 'case', id], res.data);
    qc.invalidateQueries({ queryKey: ['admin', 'cases'] });
    setModal(null);
    if (message) toast.success(message);
  };
  const addNote = useMutation({
    mutationFn: () => api.post(`${base}/notes`, { body: note }),
    onSuccess: (res) => {
      done(res);
      setNote('');
    },
  });
  const update = useMutation({ mutationFn: (body) => api.patch(base, body), onSuccess: (res) => done(res, 'Case updated') });
  const action = useMutation({
    mutationFn: ({ path, body }) => api.post(`${base}/${path}`, body),
    onSuccess: (res) => done(res, 'Recorded'),
  });

  if (c.isPending) return <Skeleton className="h-96" />;
  if (c.isError) return <ErrorState error={c.error} onRetry={c.refetch} />;
  const k = c.data;
  const closed = k.status.startsWith('CLOSED');
  const wallet = k.wallets.find((w) => w.currency === 'GHS');

  return (
    <>
      <Link to="/admin/compliance" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" /> Compliance
      </Link>
      <PageHeader
        title={k.title}
        description={`Case #${k.number} · ${CASE_TYPES[k.type]} · opened ${formatDateTime(k.createdAt)}`}
        actions={
          <span className="flex flex-wrap gap-1">
            <Badge tone={CASE_PRIORITY[k.priority].tone}>{CASE_PRIORITY[k.priority].label}</Badge>
            <Badge tone={CASE_STATUS[k.status].tone}>{CASE_STATUS[k.status].label}</Badge>
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {k.outcome && (
            <Alert tone={closed ? 'success' : 'info'} title="Outcome">
              {k.outcome}
            </Alert>
          )}
          <Card>
            <CardHeader title="Timeline" description="Entries cannot be edited or deleted." />
            <ol className="divide-y divide-border">
              {k.events.map((e) => (
                <li key={e.id} className="px-5 py-3 text-sm">
                  <p className="flex flex-wrap justify-between gap-x-3 text-xs text-ink-subtle">
                    <span className="font-medium text-ink">{CASE_EVENTS[e.kind] ?? e.kind}</span>
                    <span>
                      {e.actor} · {formatDateTime(e.createdAt)}
                    </span>
                  </p>
                  {e.body && <p className="mt-1 whitespace-pre-line text-ink-muted">{e.body}</p>}
                  {e.data?.reference && <p className="mt-1 font-mono text-xs">{e.data.reference}</p>}
                </li>
              ))}
            </ol>
            {canManage && (
              <CardBody className="border-t border-border">
                <Field label="Add a note">
                  {(p) => <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} {...p} />}
                </Field>
                <Button className="mt-3" loading={addNote.isPending} disabled={note.trim().length < 5} onClick={() => addNote.mutate()}>
                  Add note
                </Button>
              </CardBody>
            )}
          </Card>
          {k.alerts.length > 0 && (
            <Card>
              <CardHeader title="Linked alerts" />
              <ul className="divide-y divide-border">
                {k.alerts.map((a) => (
                  <li key={a.id} className="px-5 py-3 text-sm">
                    <Badge tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Badge>{' '}
                    <span className="font-medium text-ink">{ALERT_RULES[a.rule] ?? a.rule}</span>
                    <span className="block text-xs text-ink-subtle">
                      {a.summary} · {formatDateTime(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Person" />
            <CardBody className="space-y-1 text-sm">
              <p className="font-medium text-ink">{k.subject.name}</p>
              <p className="text-ink-muted">{k.subject.email}</p>
              {k.subjectProfile && (
                <dl className="mt-3 space-y-1 text-xs">
                  {[
                    ['Identity', k.subjectProfile.kycStatus],
                    ['Risk rating', k.subjectProfile.riskRating ?? 'Not set'],
                    ['Politically exposed', k.subjectProfile.politicallyExposed ? 'Yes' : 'No'],
                    [
                      'Source of funds',
                      [...(k.subjectProfile.sourceOfFunds ?? []), k.subjectProfile.sourceOfFundsDetails].filter(Boolean).join(', ') || '—',
                    ],
                    ['GHS wallet', wallet ? `${wallet.status}${wallet.statusReason ? `: ${wallet.statusReason}` : ''}` : 'None'],
                  ].map(([a, b]) => (
                    <div key={a} className="flex justify-between gap-3">
                      <dt className="text-ink-subtle">{a}</dt>
                      <dd className="text-right text-ink">{b}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <Link to={`/admin/users/${k.subject.id}`} className="mt-2 inline-block text-xs font-medium text-brand-700 underline">
                Open user record
              </Link>
            </CardBody>
          </Card>
          {canManage && (
            <Card>
              <CardHeader title="Handling" />
              <CardBody className="space-y-4">
                <Field label="Status">
                  {(p) => (
                    <Select
                      value={k.status}
                      onChange={(e) =>
                        e.target.value.startsWith('CLOSED')
                          ? setModal({ kind: 'close', status: e.target.value, outcome: k.outcome ?? '' })
                          : update.mutate({ status: e.target.value })
                      }
                      options={opts(CASE_STATUS)}
                      {...p}
                    />
                  )}
                </Field>
                <Field label="Priority">
                  {(p) => (
                    <Select
                      value={k.priority}
                      onChange={(e) => update.mutate({ priority: e.target.value })}
                      options={opts(CASE_PRIORITY)}
                      {...p}
                    />
                  )}
                </Field>
                <Field label="Assignee">
                  {(p) => (
                    <Select
                      value={k.assignee?.id ?? ''}
                      onChange={(e) => update.mutate({ assigneeId: e.target.value || null })}
                      options={[{ value: '', label: 'Unassigned' }, ...(officers.data ?? []).map((o) => ({ value: o.id, label: o.name }))]}
                      {...p}
                    />
                  )}
                </Field>
                {update.error && !modal && <Alert tone="danger">{update.error.message}</Alert>}
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setModal({ kind: 'risk', riskRating: k.subjectProfile?.riskRating ?? 'MEDIUM', reason: '' })}
                  >
                    Change risk rating
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setModal({ kind: 'wallet', frozen: wallet?.status !== 'FROZEN', reason: '' })}
                  >
                    {wallet?.status === 'FROZEN' ? 'Unfreeze wallet' : 'Freeze wallet'}
                  </Button>
                  {!k.regulatoryReference && (
                    <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'report', reference: '', note: '' })}>
                      Record regulatory report
                    </Button>
                  )}
                </div>
                {k.regulatoryReference && (
                  <p className="text-xs text-ink-muted">
                    Report filed: <span className="font-mono">{k.regulatoryReference}</span> ({formatDateTime(k.reportedAt)})
                  </p>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {modal?.kind === 'close' && (
        <ActionModal
          title="Close case"
          label="Close case"
          onClose={() => setModal(null)}
          pending={update.isPending}
          error={update.error}
          disabled={modal.outcome.trim().length < 10}
          onSubmit={() => update.mutate({ status: modal.status, outcome: modal.outcome })}
        >
          <p className="text-sm text-ink-muted">{CASE_STATUS[modal.status].label}</p>
          <Field label="Outcome (required)">
            {(p) => (
              <Textarea rows={4} value={modal.outcome} onChange={(e) => setModal((m) => ({ ...m, outcome: e.target.value }))} {...p} />
            )}
          </Field>
        </ActionModal>
      )}
      {modal?.kind === 'risk' && (
        <ActionModal
          title="Change risk rating"
          label="Save"
          onClose={() => setModal(null)}
          pending={action.isPending}
          error={action.error}
          disabled={modal.reason.trim().length < 5}
          onSubmit={() => action.mutate({ path: 'risk-rating', body: { riskRating: modal.riskRating, reason: modal.reason } })}
        >
          <Field label="Risk rating">
            {(p) => (
              <Select
                value={modal.riskRating}
                onChange={(e) => setModal((m) => ({ ...m, riskRating: e.target.value }))}
                options={[
                  { value: 'LOW', label: 'Low' },
                  { value: 'MEDIUM', label: 'Medium' },
                  { value: 'HIGH', label: 'High' },
                ]}
                {...p}
              />
            )}
          </Field>
          <Field label="Reason">
            {(p) => <Textarea rows={3} value={modal.reason} onChange={(e) => setModal((m) => ({ ...m, reason: e.target.value }))} {...p} />}
          </Field>
        </ActionModal>
      )}
      {modal?.kind === 'wallet' && (
        <ActionModal
          title={modal.frozen ? 'Freeze wallet' : 'Unfreeze wallet'}
          label={modal.frozen ? 'Freeze' : 'Unfreeze'}
          onClose={() => setModal(null)}
          pending={action.isPending}
          error={action.error}
          disabled={modal.reason.trim().length < 5}
          onSubmit={() => action.mutate({ path: 'wallet', body: { frozen: modal.frozen, reason: modal.reason } })}
        >
          <p className="text-sm text-ink-muted">
            {modal.frozen
              ? 'The person will not be able to deposit, withdraw or invest until the wallet is unfrozen. Money already in the wallet stays there.'
              : 'Normal activity resumes.'}
          </p>
          <Field label="Reason">
            {(p) => <Textarea rows={3} value={modal.reason} onChange={(e) => setModal((m) => ({ ...m, reason: e.target.value }))} {...p} />}
          </Field>
        </ActionModal>
      )}
      {modal?.kind === 'report' && (
        <ActionModal
          title="Record regulatory report"
          label="Record"
          onClose={() => setModal(null)}
          pending={action.isPending}
          error={action.error}
          disabled={modal.reference.trim().length < 3}
          onSubmit={() =>
            action.mutate({ path: 'report', body: { reference: modal.reference, ...(modal.note ? { note: modal.note } : {}) } })
          }
        >
          <Alert tone="info">
            File the report with the regulator or financial intelligence unit through their own channel first. Mynx does not file reports
            automatically.
          </Alert>
          <Field label="Report reference">
            {(p) => <Input value={modal.reference} onChange={(e) => setModal((m) => ({ ...m, reference: e.target.value }))} {...p} />}
          </Field>
          <Field label="Note (optional)">
            {(p) => <Textarea rows={2} value={modal.note} onChange={(e) => setModal((m) => ({ ...m, note: e.target.value }))} {...p} />}
          </Field>
        </ActionModal>
      )}
    </>
  );
}
