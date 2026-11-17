import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Circle, Clock, ShieldCheck } from 'lucide-react';
import { Alert, Badge, Button, Card, ErrorState, Skeleton } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  AddressForm,
  DeclarationsForm,
  FinancialForm,
  InstitutionForm,
  InvestmentForm,
  ONBOARDING_KEY,
  PersonalForm,
} from '../../features/kyc/OnboardingForms.jsx';
import { RiskQuestionnaire } from '../../features/kyc/RiskQuestionnaire.jsx';
import { DocumentsSection } from '../../features/kyc/DocumentsSection.jsx';
import { KYC_STATUS, SECTION_LABELS } from '../../features/kyc/labels.js';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { cn } from '../../utils/format.js';

function Section({ id, done, open, onToggle, children }) {
  return (
    <Card>
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`section-${id}`}
          className="flex w-full items-center gap-3 px-5 py-4 text-left"
        >
          {done ? (
            <CheckCircle2 className="size-5 shrink-0 text-success" aria-label="Complete" />
          ) : (
            <Circle className="size-5 shrink-0 text-ink-subtle" aria-label="Incomplete" />
          )}
          <span className="flex-1 font-semibold text-ink">{SECTION_LABELS[id]}</span>
          <ChevronDown className={cn('size-4 text-ink-subtle transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </h2>
      {open && (
        <div id={`section-${id}`} className="border-t border-border px-5 py-5">
          {children}
        </div>
      )}
    </Card>
  );
}

function StatusPanel({ data }) {
  const status = KYC_STATUS[data.profile.kycStatus];
  const app = data.application;
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            Verification status <Badge tone={status.tone}>{status.label}</Badge>
          </p>
          {data.editable && <p className="mt-1 text-sm text-ink-muted">{data.completion.percent}% complete</p>}
        </div>
        {data.editable && (
          <div
            className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-valuenow={data.completion.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Onboarding progress"
          >
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${data.completion.percent}%` }} />
          </div>
        )}
      </div>
      {['SUBMITTED', 'UNDER_REVIEW'].includes(data.profile.kycStatus) && (
        <Alert tone="info" title="We are reviewing your details" className="mt-4">
          Submitted {formatDateTime(app?.submittedAt)}. Reviews usually take up to 2 business days. Your details are locked while we review
          them.
        </Alert>
      )}
      {data.profile.kycStatus === 'RESUBMISSION_REQUIRED' && (
        <Alert tone="warning" title="We need a few changes" className="mt-4">
          {app?.resubmissionNotes}
        </Alert>
      )}
      {data.profile.kycStatus === 'APPROVED' && (
        <Alert tone="success" title="You are verified" className="mt-4">
          Verified {formatDateTime(data.profile.kycVerifiedAt)}. To change verified details, contact support.
        </Alert>
      )}
      {data.profile.kycStatus === 'REJECTED' && (
        <Alert tone="danger" title="We could not verify your account" className="mt-4">
          Please contact support if you have questions.
        </Alert>
      )}
    </Card>
  );
}

export default function VerificationPage() {
  usePageMeta({ title: 'Verification · Mynx' });
  const qc = useQueryClient();
  const toast = useToast();
  const overview = useQuery({ queryKey: ONBOARDING_KEY, queryFn: () => api.get('/onboarding').then((r) => r.data) });
  const [open, setOpen] = useState(null);
  const submit = useMutation({
    mutationFn: () => api.post('/kyc/submit'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ONBOARDING_KEY });
      toast.success('Submitted for review', 'We will email you when there is an update.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  if (overview.isPending) return <Skeleton className="h-96" />;
  if (overview.isError) return <ErrorState error={overview.error} onRetry={overview.refetch} />;

  const data = overview.data;
  const { sections } = data.completion;
  const disabled = !data.editable;
  const order = Object.keys(sections);
  const firstIncomplete = order.find((k) => !sections[k]);
  const current = open === null ? (data.editable ? firstIncomplete : null) : open;
  const toggle = (id) => setOpen(current === id ? '' : id);
  const next = (id) => () => setOpen(order.slice(order.indexOf(id) + 1).find((k) => !sections[k]) ?? '');
  const formProps = (id) => ({ profile: data.profile, disabled, onSaved: next(id) });

  return (
    <>
      <PageHeader
        title="Verification"
        description="We are required by law to verify the identity of everyone who invests. Your information is encrypted and handled under our privacy policy."
      />
      <StatusPanel data={data} />

      <div className="space-y-3">
        <Section id="contact" done={sections.contact} open={current === 'contact'} onToggle={() => toggle('contact')}>
          {sections.contact ? (
            <p className="text-sm text-ink-muted">Your email address and mobile number are verified.</p>
          ) : (
            <p className="text-sm text-ink-muted">
              Verify your mobile number on your{' '}
              <Link to="/app/profile" className="font-medium text-brand-700 underline">
                profile page
              </Link>{' '}
              first.
            </p>
          )}
        </Section>
        <Section id="personal" done={sections.personal} open={current === 'personal'} onToggle={() => toggle('personal')}>
          <PersonalForm {...formProps('personal')} />
        </Section>
        <Section id="address" done={sections.address} open={current === 'address'} onToggle={() => toggle('address')}>
          <AddressForm {...formProps('address')} />
        </Section>
        <Section id="financial" done={sections.financial} open={current === 'financial'} onToggle={() => toggle('financial')}>
          <FinancialForm {...formProps('financial')} />
        </Section>
        <Section id="investment" done={sections.investment} open={current === 'investment'} onToggle={() => toggle('investment')}>
          <InvestmentForm {...formProps('investment')} />
        </Section>
        {'institution' in sections && (
          <Section id="institution" done={sections.institution} open={current === 'institution'} onToggle={() => toggle('institution')}>
            <InstitutionForm {...formProps('institution')} />
          </Section>
        )}
        <Section id="declarations" done={sections.declarations} open={current === 'declarations'} onToggle={() => toggle('declarations')}>
          <DeclarationsForm {...formProps('declarations')} />
        </Section>
        <Section
          id="riskAssessment"
          done={sections.riskAssessment}
          open={current === 'riskAssessment'}
          onToggle={() => toggle('riskAssessment')}
        >
          <RiskQuestionnaire current={data.riskAssessment} disabled={disabled} onSaved={next('riskAssessment')} />
        </Section>
        <Section id="documents" done={sections.documents} open={current === 'documents'} onToggle={() => toggle('documents')}>
          <DocumentsSection completion={data.completion} documents={data.documents} disabled={disabled} />
        </Section>
      </div>

      {data.editable && (
        <Card className="mt-6 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-3 text-sm text-ink-muted">
              {data.completion.complete ? (
                <ShieldCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Clock className="size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
              )}
              {data.completion.complete
                ? 'Everything is ready. Once submitted, your details are locked while our compliance team reviews them.'
                : `Still to do: ${data.completion.missing.map((m) => SECTION_LABELS[m].toLowerCase()).join(', ')}.`}
            </p>
            <Button onClick={() => submit.mutate()} disabled={!data.completion.complete} loading={submit.isPending}>
              {data.application?.status === 'RESUBMISSION_REQUIRED' ? 'Resubmit for review' : 'Submit for review'}
            </Button>
          </div>
          {submit.error && (
            <Alert tone="danger" className="mt-4">
              {submit.error.message}
            </Alert>
          )}
        </Card>
      )}
    </>
  );
}
