import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Eye } from 'lucide-react';
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
  Select,
  Skeleton,
  Textarea,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { hasPermission, useSession } from '../../features/auth/useSession.js';
import { useToast } from '../../context/ToastContext.jsx';
import { openDocument } from '../../features/kyc/DocumentsSection.jsx';
import {
  COUNTRIES,
  DOC_STATUS,
  DOCUMENT_TYPES,
  EMPLOYMENT,
  EXPERIENCE,
  ID_TYPES,
  INCOME_BANDS,
  KYC_STATUS,
  OBJECTIVES,
  RISK_PROFILES,
  SCREENING_STATUS,
  SOURCES,
} from '../../features/kyc/labels.js';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const list = (values, map) => (values?.length ? values.map((v) => map[v] ?? v).join(', ') : '—');

function Details({ rows }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-ink-subtle">{label}</dt>
          <dd className="mt-0.5 font-medium break-words text-ink">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function DecisionForm({ app, onDone }) {
  const toast = useToast();
  const current = app.documents.filter((d) => d.current);
  const [docs, setDocs] = useState(() =>
    Object.fromEntries(current.map((d) => [d.id, { status: d.status === 'UPLOADED' ? '' : d.status, reason: d.rejectionReason ?? '' }])),
  );
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const [riskRating, setRiskRating] = useState('');
  const [screeningCleared, setScreeningCleared] = useState(false);
  const match = app.screening[0]?.status === 'POTENTIAL_MATCH';
  const pep = app.currentProfile?.isPoliticallyExposed;

  const decide = useMutation({
    mutationFn: () =>
      api.post(`/admin/kyc/applications/${app.id}/decision`, {
        decision,
        reason,
        ...(decision === 'APPROVE' ? { riskRating, screeningCleared: match ? screeningCleared : undefined } : {}),
        documents: Object.entries(docs)
          .filter(([, d]) => d.status)
          .map(([id, d]) => ({ id, status: d.status, ...(d.status === 'REJECTED' ? { reason: d.reason } : {}) })),
      }),
    onSuccess: () => {
      toast.success('Decision recorded');
      onDone();
    },
  });

  const allAccepted = app.requiredDocumentTypes.every((t) => docs[current.find((d) => d.type === t)?.id]?.status === 'ACCEPTED');
  const rejectedMissingReason = Object.values(docs).some((d) => d.status === 'REJECTED' && !d.reason.trim());

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-ink">Documents</h3>
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {current.map((d) => (
            <li key={d.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium text-ink">{DOCUMENT_TYPES[d.type].label}</span>
                  {!app.requiredDocumentTypes.includes(d.type) && <span className="ml-2 text-xs text-ink-subtle">(optional)</span>}
                  <button
                    type="button"
                    onClick={() => openDocument(d.id).catch((e) => toast.error('Could not open', e.message))}
                    className="ml-3 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                  >
                    <Eye className="size-3.5" aria-hidden="true" /> View
                  </button>
                </div>
                <div className="flex gap-1" role="radiogroup" aria-label={`Decision for ${DOCUMENT_TYPES[d.type].label}`}>
                  {['ACCEPTED', 'REJECTED'].map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      role="radio"
                      aria-checked={docs[d.id].status === s}
                      variant={docs[d.id].status === s ? (s === 'ACCEPTED' ? 'accent' : 'danger') : 'secondary'}
                      onClick={() => setDocs((x) => ({ ...x, [d.id]: { ...x[d.id], status: s } }))}
                    >
                      {s === 'ACCEPTED' ? 'Accept' : 'Reject'}
                    </Button>
                  ))}
                </div>
              </div>
              {docs[d.id].status === 'REJECTED' && (
                <Input
                  aria-label="Rejection reason (shown to the applicant)"
                  placeholder="Reason shown to the applicant, e.g. image blurred"
                  value={docs[d.id].reason}
                  onChange={(e) => setDocs((x) => ({ ...x, [d.id]: { ...x[d.id], reason: e.target.value } }))}
                />
              )}
            </li>
          ))}
        </ul>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">Decision</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {[
            ['APPROVE', 'Approve', 'All checks passed'],
            ['REQUEST_RESUBMISSION', 'Request changes', 'Applicant fixes and resubmits'],
            ['REJECT', 'Reject', 'Final. Applicant gets a generic notice'],
          ].map(([value, label, hint]) => (
            <label
              key={value}
              className="cursor-pointer rounded-lg border border-border p-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
            >
              <input
                type="radio"
                name="decision"
                value={value}
                checked={decision === value}
                onChange={() => setDecision(value)}
                className="sr-only"
              />
              <span className="block font-medium text-ink">{label}</span>
              <span className="block text-xs text-ink-muted">{hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {decision === 'APPROVE' && (
        <>
          <Field
            label="Customer risk rating"
            hint={pep ? 'Politically exposed person: HIGH is required.' : undefined}
            required
            className="max-w-xs"
          >
            {(p) => (
              <Select
                placeholder="Select…"
                value={riskRating}
                onChange={(e) => setRiskRating(e.target.value)}
                options={['LOW', 'MEDIUM', 'HIGH'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))}
                {...p}
              />
            )}
          </Field>
          {match && (
            <label className="flex items-start gap-3 rounded-lg bg-danger-soft p-3 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-danger"
                checked={screeningCleared}
                onChange={(e) => setScreeningCleared(e.target.checked)}
              />
              <span>
                I have reviewed the potential screening match and confirm it is a false positive. My justification is in the note below.
              </span>
            </label>
          )}
          {!allAccepted && <Alert tone="warning">Every required document must be accepted before approving.</Alert>}
        </>
      )}

      {decision && (
        <Field
          label={decision === 'REQUEST_RESUBMISSION' ? 'Message to the applicant' : 'Internal note (audit record)'}
          hint={
            decision === 'REQUEST_RESUBMISSION'
              ? 'Sent to the applicant by email. Be specific and polite.'
              : 'Not shown to the applicant. Minimum 10 characters.'
          }
          required
        >
          {(p) => <Textarea value={reason} onChange={(e) => setReason(e.target.value)} {...p} />}
        </Field>
      )}

      {decide.error && <Alert tone="danger">{decide.error.details?.[0]?.message ?? decide.error.message}</Alert>}

      <div className="flex justify-end">
        <Button
          variant={decision === 'REJECT' ? 'danger' : 'primary'}
          disabled={
            !decision ||
            reason.trim().length < 10 ||
            rejectedMissingReason ||
            (decision === 'APPROVE' && (!riskRating || !allAccepted || (match && !screeningCleared)))
          }
          loading={decide.isPending}
          onClick={() => decide.mutate()}
        >
          Record decision
        </Button>
      </div>
    </div>
  );
}

export default function KycReviewPage() {
  const { id } = useParams();
  const { data: session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const detail = useQuery({
    queryKey: ['admin', 'kyc', 'detail', id],
    queryFn: () => api.get(`/admin/kyc/applications/${id}`).then((r) => r.data),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'kyc'] });
  const claim = useMutation({
    mutationFn: () => api.post(`/admin/kyc/applications/${id}/claim`),
    onSuccess: refresh,
    onError: (e) => toast.error('Could not claim', e.message),
  });
  const release = useMutation({
    mutationFn: () => api.post(`/admin/kyc/applications/${id}/release`),
    onSuccess: refresh,
    onError: (e) => toast.error('Could not release', e.message),
  });
  usePageMeta({ title: 'KYC application · Mynx Admin' });

  if (detail.isPending) return <Skeleton className="h-96" />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={detail.refetch} />;

  const app = detail.data;
  const p = app.currentProfile ?? {};
  const name = app.applicant.organizationName ?? `${app.applicant.firstName} ${app.applicant.lastName}`;
  const canReview = hasPermission(session, 'kyc:review');
  const mine = app.reviewer?.id === session?.user.id;
  const screening = app.screening[0];

  return (
    <>
      <Link to="/admin/kyc" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" /> Review queue
      </Link>
      <PageHeader
        title={name}
        description={`${app.applicant.email} · submitted ${formatDateTime(app.submittedAt)}${app.submissionCount > 1 ? ` · submission #${app.submissionCount}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={KYC_STATUS[app.status].tone}>{KYC_STATUS[app.status].label}</Badge>
            {canReview && app.status === 'SUBMITTED' && (
              <Button onClick={() => claim.mutate()} loading={claim.isPending}>
                Start review
              </Button>
            )}
            {canReview && app.status === 'UNDER_REVIEW' && mine && (
              <Button variant="secondary" onClick={() => release.mutate()} loading={release.isPending}>
                Return to queue
              </Button>
            )}
          </div>
        }
      />
      {app.status === 'UNDER_REVIEW' && !mine && (
        <Alert tone="info" className="mb-6">
          {app.reviewer?.name ?? 'Another reviewer'} is reviewing this application.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canReview && app.status === 'UNDER_REVIEW' && mine && (
            <Card>
              <CardHeader title="Your review" description="Check each document against the details below." />
              <CardBody>
                <DecisionForm app={app} onDone={refresh} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Identity" />
            <CardBody>
              <Details
                rows={[
                  ['Name', `${app.applicant.firstName} ${app.applicant.lastName}`],
                  ['Date of birth', p.dateOfBirth],
                  ['Nationality', COUNTRIES[p.nationality] ?? p.nationality],
                  ['Document', ID_TYPES[p.idType]],
                  ['Document number', p.idNumberMasked],
                  ['Expires', p.idExpiryDate],
                  ['Issuing country', COUNTRIES[p.idIssuingCountry] ?? p.idIssuingCountry],
                  ['Phone', app.applicant.phone],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Address" />
            <CardBody>
              <Details
                rows={[
                  ['Address', [p.addressLine1, p.addressLine2].filter(Boolean).join(', ')],
                  ['Town / city', p.city],
                  ['Region', p.region],
                  ['Digital address / postcode', p.postalCode],
                  ['Country', COUNTRIES[p.addressCountry] ?? p.addressCountry],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Financial profile and declarations" />
            <CardBody>
              <Details
                rows={[
                  ['Employment', EMPLOYMENT[p.employmentStatus]],
                  ['Occupation', p.occupation ? `${p.occupation}${p.employerName ? ` at ${p.employerName}` : ''}` : null],
                  ['Annual income', INCOME_BANDS[p.annualIncomeBand]],
                  ['Source of funds', list(p.sourceOfFunds, SOURCES) + (p.sourceOfFundsDetails ? `: ${p.sourceOfFundsDetails}` : '')],
                  ['Objectives', list(p.investmentObjectives, OBJECTIVES)],
                  ['Experience', EXPERIENCE[p.investmentExperience]],
                  ['Politically exposed', p.isPoliticallyExposed ? `Yes: ${p.pepDetails}` : 'No'],
                  ['Tax residence', COUNTRIES[p.taxResidency] ?? p.taxResidency],
                  ...(app.applicant.type === 'INSTITUTIONAL'
                    ? [
                        ['Registration number', p.registrationNumber],
                        [
                          'Incorporated',
                          `${p.incorporationDate ?? '—'} (${COUNTRIES[p.incorporationCountry] ?? p.incorporationCountry ?? '—'})`,
                        ],
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Screening" description={screening ? `Provider: ${screening.provider}` : undefined} />
            <CardBody className="space-y-2 text-sm">
              {!screening && <p className="text-ink-muted">Not screened.</p>}
              {screening && (
                <>
                  <Badge tone={SCREENING_STATUS[screening.status].tone}>{SCREENING_STATUS[screening.status].label}</Badge>
                  {screening.provider === 'sandbox' && (
                    <p className="text-xs text-ink-subtle">Sandbox provider: no real watch-lists are checked.</p>
                  )}
                  {screening.matches.map((m, i) => (
                    <p key={i} className="flex items-start gap-2 rounded-md bg-danger-soft p-2 text-xs text-ink">
                      <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden="true" />
                      {m.list}: “{m.matchedName}” (score {m.score})
                    </p>
                  ))}
                </>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Risk questionnaire" />
            <CardBody className="text-sm">
              {app.riskAssessment ? (
                <p>
                  <Badge tone="info">{RISK_PROFILES[app.riskAssessment.riskProfile]}</Badge>
                  <span className="tabular ml-2 text-ink-subtle">score {app.riskAssessment.score}/100</span>
                </p>
              ) : (
                <p className="text-ink-muted">Not completed.</p>
              )}
              {app.riskRating && <p className="mt-2 text-ink-muted">Assigned customer risk: {app.riskRating}</p>}
            </CardBody>
          </Card>
          {app.status !== 'UNDER_REVIEW' || !mine ? (
            <Card>
              <CardHeader title="Documents" />
              <ul className="divide-y divide-border">
                {app.documents
                  .filter((d) => d.current)
                  .map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                      <span>
                        <span className="block text-ink">{DOCUMENT_TYPES[d.type].label}</span>
                        <Badge tone={DOC_STATUS[d.status].tone}>{DOC_STATUS[d.status].label}</Badge>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openDocument(d.id).catch((e) => toast.error('Could not open', e.message))}
                      >
                        <Eye className="size-4" aria-hidden="true" /> View
                      </Button>
                    </li>
                  ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="History" />
            <ol className="space-y-3 px-5 py-4 text-sm">
              {app.history.map((h) => (
                <li key={h.id} className="border-l-2 border-border pl-3">
                  <p className="font-medium text-ink">
                    {KYC_STATUS[h.toStatus].label}
                    {h.actor && <span className="font-normal text-ink-muted"> by {h.actor}</span>}
                  </p>
                  <p className="text-xs text-ink-subtle">{formatDateTime(h.createdAt)}</p>
                  {h.note && <p className="mt-1 text-xs text-ink-muted">{h.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
