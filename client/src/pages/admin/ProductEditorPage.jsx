import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, FileText, Trash2, Upload } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api, applyServerErrors } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PRODUCT_STATUS, PRODUCT_TYPES, RISK_LEVEL_LABEL } from '../../features/investments/shared.jsx';
import { RISK_PROFILES, options } from '../../features/kyc/labels.js';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const DOC_KINDS = {
  KEY_INFORMATION: 'Key information document',
  TERM_SHEET: 'Term sheet',
  PROSPECTUS: 'Prospectus',
  RISK_DISCLOSURE: 'Risk disclosure',
  ANNUAL_REPORT: 'Annual report',
  OTHER: 'Other',
};

const toLocal = (iso) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);
const blankToNull = (v) => (v === '' || v === undefined ? null : v);

function defaults(p) {
  return {
    name: p?.name ?? '',
    slug: p?.slug ?? '',
    shortDescription: p?.shortDescription ?? '',
    description: p?.description ?? '',
    categorySlug: p?.category?.slug ?? '',
    productType: p?.productType ?? '',
    issuerName: p?.issuerName ?? '',
    currency: p?.currency ?? 'GHS',
    minInvestment: p?.minInvestment?.decimal ?? '',
    maxInvestment: p?.maxInvestment?.decimal ?? '',
    increment: p?.increment?.decimal ?? '',
    capacity: p?.capacity?.decimal ?? '',
    returnType: p?.returnType ?? 'TARGET',
    annualRatePercent: p?.annualRatePercent ?? '',
    termDays: p?.termDays ?? '',
    maturityDate: p?.maturityDate ?? '',
    lockupDays: p?.lockupDays ?? '',
    redemptionTerms: p?.redemptionTerms ?? '',
    entryFeePercent: p?.fees?.entryPercent ?? '0',
    managementFeePercent: p?.fees?.managementPercent ?? '0',
    earlyExitFeePercent: p?.fees?.earlyExitPercent ?? '0',
    feeNotes: p?.fees?.notes ?? '',
    riskLevel: p?.riskLevel ?? 3,
    minRiskProfile: p?.minRiskProfile ?? 'BALANCED',
    riskDisclosure: p?.riskDisclosure ?? '',
    individual: p ? p.eligibleInvestorTypes.includes('INDIVIDUAL') : true,
    institutional: p ? p.eligibleInvestorTypes.includes('INSTITUTIONAL') : true,
    subscriptionOpensAt: toLocal(p?.subscriptionOpensAt),
    subscriptionClosesAt: toLocal(p?.subscriptionClosesAt),
  };
}

function toPayload(v, isNew) {
  const num = (x) => (x === '' || x === null ? null : Number(x));
  return {
    ...(isNew && v.slug ? { slug: v.slug } : {}),
    name: v.name,
    shortDescription: v.shortDescription,
    description: v.description,
    categorySlug: v.categorySlug,
    productType: v.productType,
    issuerName: v.issuerName,
    currency: v.currency,
    minInvestment: v.minInvestment,
    maxInvestment: blankToNull(v.maxInvestment),
    increment: blankToNull(v.increment),
    capacity: blankToNull(v.capacity),
    returnType: v.returnType,
    annualRatePercent: v.returnType === 'NONE' ? null : blankToNull(v.annualRatePercent),
    termDays: num(v.termDays),
    maturityDate: blankToNull(v.maturityDate),
    lockupDays: num(v.lockupDays),
    redemptionTerms: v.redemptionTerms,
    entryFeePercent: v.entryFeePercent || '0',
    managementFeePercent: v.managementFeePercent || '0',
    earlyExitFeePercent: v.earlyExitFeePercent || '0',
    feeNotes: blankToNull(v.feeNotes),
    riskLevel: Number(v.riskLevel),
    minRiskProfile: v.minRiskProfile,
    riskDisclosure: v.riskDisclosure,
    eligibleInvestorTypes: [v.individual && 'INDIVIDUAL', v.institutional && 'INSTITUTIONAL'].filter(Boolean),
    subscriptionOpensAt: fromLocal(v.subscriptionOpensAt),
    subscriptionClosesAt: fromLocal(v.subscriptionClosesAt),
  };
}

function ProductForm({ product, categories, readOnly, onSaved }) {
  const isNew = !product;
  const toast = useToast();
  const form = useForm({ defaultValues: defaults(product) });
  const e = form.formState.errors;
  const returnType = form.watch('returnType');
  const save = useMutation({
    mutationFn: (v) =>
      isNew ? api.post('/admin/products', toPayload(v, true)) : api.patch(`/admin/products/${product.id}`, toPayload(v, false)),
    onSuccess: (res) => {
      toast.success(isNew ? 'Draft created' : 'Changes saved');
      onSaved(res.data);
    },
    onError: (err) => {
      const mapped = applyServerErrors(err, (path, v) => form.setError(path === 'eligibleInvestorTypes' ? 'individual' : path, v));
      toast.error('Could not save', mapped ? 'Check the highlighted fields.' : err.message);
    },
  });
  const reg = (name, opts) => form.register(name, opts);
  const text = (name, label, props = {}) => (
    <Field label={label} error={e[name]?.message} hint={props.hint} required={props.required}>
      {(p) => <Input {...p} {...reg(name)} {...props.input} />}
    </Field>
  );

  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <fieldset disabled={readOnly} className="space-y-6">
        <Card>
          <CardHeader title="Overview" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {text('name', 'Name', { required: true })}
            {isNew ? (
              text('slug', 'URL name (optional)', { hint: 'Generated from the name if blank, e.g. 91-day-treasury-bill' })
            ) : (
              <Field label="URL name">{(p) => <Input {...p} value={product.slug} disabled />}</Field>
            )}
            <Field label="Category" error={e.categorySlug?.message} required>
              {(p) => (
                <Select
                  placeholder="Select…"
                  options={categories.map((c) => ({ value: c.slug, label: c.name }))}
                  {...p}
                  {...reg('categorySlug')}
                />
              )}
            </Field>
            <Field label="Product type" error={e.productType?.message} required>
              {(p) => <Select placeholder="Select…" options={options(PRODUCT_TYPES)} {...p} {...reg('productType')} />}
            </Field>
            <div className="sm:col-span-2">{text('issuerName', 'Issuer', { required: true })}</div>
            <div className="sm:col-span-2">
              {text('shortDescription', 'Short description', { required: true, hint: 'Shown on marketplace cards (10–300 characters).' })}
            </div>
            <Field
              label="Full description"
              error={e.description?.message}
              hint="At least 100 characters to publish."
              required
              className="sm:col-span-2"
            >
              {(p) => <Textarea rows={6} {...p} {...reg('description')} />}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Amounts and return"
            description="Amounts in the product currency (e.g. 500.00). Rates as percentages (e.g. 24.5)."
          />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Currency" error={e.currency?.message} required>
              {(p) => <Select options={[{ value: 'GHS', label: 'GHS (Ghana Cedi)' }]} {...p} {...reg('currency')} />}
            </Field>
            {text('minInvestment', 'Minimum investment', { required: true, input: { inputMode: 'decimal' } })}
            {text('maxInvestment', 'Maximum per investor', { input: { inputMode: 'decimal' } })}
            {text('increment', 'Increment', { hint: 'Amounts must be multiples of this', input: { inputMode: 'decimal' } })}
            {text('capacity', 'Total capacity', { input: { inputMode: 'decimal' } })}
            <div />
            <Field label="Return type" error={e.returnType?.message} required>
              {(p) => (
                <Select
                  options={[
                    { value: 'FIXED', label: 'Fixed by contract' },
                    { value: 'TARGET', label: 'Target (not guaranteed)' },
                    { value: 'NONE', label: 'No stated return' },
                  ]}
                  {...p}
                  {...reg('returnType')}
                />
              )}
            </Field>
            {returnType !== 'NONE' && text('annualRatePercent', 'Annual rate (%)', { required: true, input: { inputMode: 'decimal' } })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Term, liquidity and fees" />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            {text('termDays', 'Term (days)', { hint: 'Leave blank for open-ended products', input: { inputMode: 'numeric' } })}
            {text('maturityDate', 'Maturity date', { input: { type: 'date' } })}
            {text('lockupDays', 'Lock-up (days)', { input: { inputMode: 'numeric' } })}
            <Field label="Redemption terms" error={e.redemptionTerms?.message} required className="sm:col-span-3">
              {(p) => <Textarea rows={3} {...p} {...reg('redemptionTerms')} />}
            </Field>
            {text('entryFeePercent', 'Entry fee (%)', { input: { inputMode: 'decimal' } })}
            {text('managementFeePercent', 'Annual management fee (%)', { input: { inputMode: 'decimal' } })}
            {text('earlyExitFeePercent', 'Early exit fee (%)', { input: { inputMode: 'decimal' } })}
            <div className="sm:col-span-3">{text('feeNotes', 'Fee notes (optional)')}</div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Risk, suitability and eligibility" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Risk level" error={e.riskLevel?.message} required>
              {(p) => (
                <Select
                  options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: `${n}: ${RISK_LEVEL_LABEL[n]}` }))}
                  {...p}
                  {...reg('riskLevel')}
                />
              )}
            </Field>
            <Field label="Suitable from risk profile" error={e.minRiskProfile?.message} required>
              {(p) => <Select options={options(RISK_PROFILES)} {...p} {...reg('minRiskProfile')} />}
            </Field>
            <Field
              label="Product risk disclosure"
              error={e.riskDisclosure?.message}
              hint="Specific to this product. At least 100 characters to publish."
              required
              className="sm:col-span-2"
            >
              {(p) => <Textarea rows={5} {...p} {...reg('riskDisclosure')} />}
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium text-ink">Available to</legend>
              <div className="mt-2 flex gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="size-4 accent-brand-600" {...reg('individual')} /> Individuals
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="size-4 accent-brand-600" {...reg('institutional')} /> Organisations
                </label>
              </div>
              {e.individual && (
                <p role="alert" className="mt-1 text-xs font-medium text-danger">
                  {e.individual.message}
                </p>
              )}
            </fieldset>
            {text('subscriptionOpensAt', 'Subscriptions open (optional)', { input: { type: 'datetime-local' } })}
            {text('subscriptionClosesAt', 'Subscriptions close (optional)', { input: { type: 'datetime-local' } })}
          </CardBody>
        </Card>

        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending}>
              {isNew ? 'Create draft' : 'Save changes'}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

function Documents({ product, canManage, editable, onChange }) {
  const toast = useToast();
  const input = useRef(null);
  const [kind, setKind] = useState('KEY_INFORMATION');
  const [title, setTitle] = useState('');
  const upload = useMutation({
    mutationFn: (file) => {
      const body = new FormData();
      body.append('kind', kind);
      body.append('title', title || DOC_KINDS[kind]);
      body.append('file', file);
      return api.post(`/admin/products/${product.id}/documents`, body);
    },
    onSuccess: (res) => {
      setTitle('');
      onChange(res.data);
      toast.success('Document added');
    },
    onError: (err) => toast.error('Upload failed', err.message),
  });
  const remove = useMutation({
    mutationFn: (docId) => api.delete(`/admin/products/${product.id}/documents/${docId}`),
    onSuccess: (res) => onChange(res.data),
    onError: (err) => toast.error('Could not remove', err.message),
  });
  return (
    <Card>
      <CardHeader title="Documents" description="PDF only. A key information document or term sheet is required to publish." />
      <ul className="divide-y divide-border">
        {product.documents.length === 0 && <li className="px-5 py-3 text-sm text-ink-muted">No documents yet.</li>}
        {product.documents.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="flex items-center gap-2">
              <FileText className="size-4 text-ink-subtle" aria-hidden="true" />
              <span>
                <span className="block font-medium text-ink">{d.title}</span>
                <span className="text-xs text-ink-subtle">{DOC_KINDS[d.kind]}</span>
              </span>
            </span>
            {canManage && product.status === 'DRAFT' && (
              <Button size="sm" variant="ghost" aria-label={`Remove ${d.title}`} onClick={() => remove.mutate(d.id)}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage && editable && (
        <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Kind">
            {(p) => <Select options={options(DOC_KINDS)} value={kind} onChange={(e) => setKind(e.target.value)} {...p} />}
          </Field>
          <Field label="Title">
            {(p) => <Input placeholder={DOC_KINDS[kind]} value={title} onChange={(e) => setTitle(e.target.value)} {...p} />}
          </Field>
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            className="sr-only"
            aria-label="Choose PDF"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
          <Button variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}>
            <Upload className="size-4" aria-hidden="true" /> Upload PDF
          </Button>
        </div>
      )}
    </Card>
  );
}

function Performance({ product, canManage, onChange }) {
  const toast = useToast();
  const [v, setV] = useState({ periodStart: '', periodEnd: '', returnPercent: '', source: '', sourceUrl: '' });
  const add = useMutation({
    mutationFn: () => api.post(`/admin/products/${product.id}/performance`, { ...v, sourceUrl: v.sourceUrl || undefined }),
    onSuccess: (res) => {
      setV({ periodStart: '', periodEnd: '', returnPercent: '', source: '', sourceUrl: '' });
      onChange(res.data);
      toast.success('Performance recorded');
    },
  });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Card>
      <CardHeader
        title="Historical performance"
        description="Completed periods only, each with a verifiable source. Records cannot be edited once saved."
      />
      <ul className="divide-y divide-border text-sm">
        {product.performance.length === 0 && <li className="px-5 py-3 text-ink-muted">No records. Nothing is shown publicly.</li>}
        {product.performance.map((r) => (
          <li key={r.id} className="flex justify-between gap-4 px-5 py-3">
            <span className="text-ink">
              {r.periodStart} – {r.periodEnd}
            </span>
            <span className="tabular font-medium text-ink">{r.returnPercent}%</span>
            <span className="flex-1 truncate text-right text-ink-muted">{r.source}</span>
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="grid gap-3 border-t border-border p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          {add.error && (
            <Alert tone="danger" className="sm:col-span-2">
              {add.error.details?.[0]?.message ?? add.error.message}
            </Alert>
          )}
          <Field label="Period start">{(p) => <Input type="date" value={v.periodStart} onChange={set('periodStart')} {...p} />}</Field>
          <Field label="Period end">{(p) => <Input type="date" value={v.periodEnd} onChange={set('periodEnd')} {...p} />}</Field>
          <Field label="Return (%)" hint="Negative allowed, e.g. -3.5">
            {(p) => <Input inputMode="decimal" value={v.returnPercent} onChange={set('returnPercent')} {...p} />}
          </Field>
          <Field label="Source" hint="e.g. Audited annual report 2025">
            {(p) => <Input value={v.source} onChange={set('source')} {...p} />}
          </Field>
          <Field label="Source URL (optional)" className="sm:col-span-2">
            {(p) => <Input type="url" value={v.sourceUrl} onChange={set('sourceUrl')} {...p} />}
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button
              type="submit"
              variant="secondary"
              loading={add.isPending}
              disabled={!v.periodStart || !v.periodEnd || !v.returnPercent || v.source.trim().length < 5}
            >
              Record performance
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Lifecycle({ product, session, onChange }) {
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState('');
  const canPublish = hasPermission(session, 'products:publish');
  const lastEditorIsMe = product.updatedBy?.id === session.user.id;
  const act = useMutation({
    mutationFn: (action) =>
      api.post(`/admin/products/${product.id}/${action}`, action === 'publish' ? undefined : reason ? { reason } : {}),
    onSuccess: (res, action) => {
      setModal(null);
      setReason('');
      onChange(res.data);
      toast.success({ publish: 'Published', suspend: 'Suspended', close: 'Closed to new investment', archive: 'Archived' }[action]);
    },
  });
  const s = product.status;
  const actions = [
    ['publish', s === 'SUSPENDED' ? 'Republish' : 'Publish', ['DRAFT', 'SUSPENDED']],
    ['suspend', 'Suspend', ['PUBLISHED']],
    ['close', 'Close to new investment', ['PUBLISHED', 'SUSPENDED']],
    ['archive', 'Archive', ['DRAFT', 'SUSPENDED', 'CLOSED']],
  ].filter(([, , from]) => from.includes(s));

  return (
    <Card>
      <CardHeader title="Lifecycle" />
      <CardBody className="space-y-3 text-sm">
        <p className="flex items-center gap-2">
          Status <Badge tone={PRODUCT_STATUS[s].tone}>{PRODUCT_STATUS[s].label}</Badge>
          {product.version > 0 && <span className="text-ink-subtle">v{product.version}</span>}
        </p>
        {product.statusReason && <p className="text-ink-muted">Reason: {product.statusReason}</p>}
        <p className="text-xs text-ink-subtle">
          Last edited by {product.updatedBy?.name} · {formatDateTime(product.updatedAt)}
        </p>
        {s === 'PUBLISHED' && (
          <Link to={`/investments/${product.slug}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
            View public page <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        )}
        {canPublish && actions.length > 0 && (
          <div className="flex flex-col gap-2 pt-2">
            {actions.map(([a, label]) => (
              <Button
                key={a}
                variant={a === 'publish' ? 'accent' : a === 'suspend' ? 'danger' : 'secondary'}
                onClick={() => setModal(a)}
                disabled={a === 'publish' && lastEditorIsMe}
              >
                {label}
              </Button>
            ))}
            {['DRAFT', 'SUSPENDED'].includes(s) && lastEditorIsMe && (
              <p className="text-xs text-ink-muted">You made the latest changes, so another colleague must publish (four-eyes rule).</p>
            )}
          </div>
        )}
        {product.versions?.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">Published versions</p>
            <ul className="mt-1 space-y-1 text-xs text-ink-muted">
              {product.versions.map((v) => (
                <li key={v.version}>
                  v{v.version} · {formatDateTime(v.publishedAt)} · {v.publishedBy}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
      <Modal
        open={Boolean(modal)}
        onClose={() => (setModal(null), act.reset())}
        title={
          {
            publish: 'Publish this product?',
            suspend: 'Suspend this product?',
            close: 'Close to new investment?',
            archive: 'Archive this product?',
          }[modal] ?? ''
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              variant={modal === 'suspend' ? 'danger' : 'primary'}
              loading={act.isPending}
              disabled={modal === 'suspend' && reason.trim().length < 10}
              onClick={() => act.mutate(modal)}
            >
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-muted">
          {act.error && (
            <Alert tone="danger" title={act.error.message}>
              {act.error.details?.map((d) => (
                <span key={d.path} className="block">
                  {d.message}
                </span>
              ))}
            </Alert>
          )}
          {modal === 'publish' && <p>The terms become visible on the marketplace and are locked. A version snapshot is stored.</p>}
          {modal === 'suspend' && <p>The product is hidden from the marketplace. Terms can then be edited and republished.</p>}
          {modal === 'close' && <p>The product stays visible as closed. New subscriptions will not be accepted.</p>}
          {modal === 'archive' && <p>The product is retired. This cannot be undone.</p>}
          {modal && modal !== 'publish' && (
            <Field label={modal === 'suspend' ? 'Reason (required, recorded in the audit log)' : 'Reason (optional)'}>
              {(p) => <Textarea value={reason} onChange={(e) => setReason(e.target.value)} {...p} />}
            </Field>
          )}
        </div>
      </Modal>
    </Card>
  );
}

export default function ProductEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const categories = useQuery({
    queryKey: ['admin', 'product-categories'],
    queryFn: () => api.get('/admin/products/categories').then((r) => r.data),
  });
  const product = useQuery({
    queryKey: ['admin', 'products', 'detail', id],
    queryFn: () => api.get(`/admin/products/${id}`).then((r) => r.data),
    enabled: !isNew,
  });
  usePageMeta({ title: `${isNew ? 'New product' : (product.data?.name ?? 'Product')} · Mynx Admin` });

  const update = (data) => {
    qc.setQueryData(['admin', 'products', 'detail', data.id], data);
    qc.invalidateQueries({ queryKey: ['admin', 'products'], exact: false, refetchType: 'none' });
  };

  if (categories.isPending || (!isNew && product.isPending)) return <Skeleton className="h-96" />;
  if (categories.isError) return <ErrorState error={categories.error} onRetry={categories.refetch} />;
  if (!isNew && product.isError) return <ErrorState error={product.error} onRetry={product.refetch} />;

  const p = product.data;
  const canManage = hasPermission(session, 'products:manage');
  const editable = isNew || ['DRAFT', 'SUSPENDED'].includes(p.status);
  const activeCategories = categories.data.filter((c) => c.isActive || c.slug === p?.category?.slug);

  return (
    <>
      <Link to="/admin/products" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" /> All products
      </Link>
      <PageHeader
        title={isNew ? 'New product' : p.name}
        description={
          isNew
            ? 'Creates a private draft. Nothing is visible to investors until it is published.'
            : `${PRODUCT_TYPES[p.productType]} · ${p.issuerName}`
        }
      />
      {!isNew && !editable && p.status !== 'ARCHIVED' && (
        <Alert tone="info" className="mb-6">
          Published terms are locked. Suspend the product to make changes, then republish.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProductForm
            key={p?.updatedAt ?? 'new'}
            product={p}
            categories={activeCategories}
            readOnly={!canManage || !editable}
            onSaved={(data) => {
              update(data);
              if (isNew) navigate(`/admin/products/${data.id}`, { replace: true });
            }}
          />
        </div>
        {!isNew && (
          <div className="space-y-6">
            <Lifecycle product={p} session={session} onChange={update} />
            <Documents product={p} canManage={canManage} editable={editable} onChange={update} />
            <Performance product={p} canManage={canManage} onChange={update} />
          </div>
        )}
      </div>
    </>
  );
}
