import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { Alert, Button, Field, Input, Select } from '../../components/ui/index.js';
import { api, applyServerErrors } from '../../services/api.js';
import { AuthCard, PASSWORD_HINT, PasswordInput } from '../../features/auth/AuthCard.jsx';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { cn } from '../../utils/format.js';

const COUNTRIES = [
  { value: 'GH', label: 'Ghana' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'KE', label: 'Kenya' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
];

const schema = z
  .object({
    accountType: z.enum(['INDIVIDUAL', 'INSTITUTIONAL']),
    firstName: z.string().trim().min(1, 'Enter your first name').max(100),
    lastName: z.string().trim().min(1, 'Enter your last name').max(100),
    organizationName: z.string().trim().max(200).optional(),
    email: z.string().trim().email('Enter a valid email address'),
    password: z.string().min(12, 'Use at least 12 characters').max(128),
    country: z.string().length(2),
    referralCode: z
      .string()
      .trim()
      .regex(/^([A-Za-z0-9]{6,16})?$/, 'Referral codes are 6 to 16 letters and numbers'),
    acceptTerms: z.boolean().refine((v) => v, 'You must accept to continue'),
  })
  .refine((v) => v.accountType !== 'INSTITUTIONAL' || (v.organizationName && v.organizationName.length >= 2), {
    path: ['organizationName'],
    message: 'Enter your organisation’s registered name',
  });

export default function RegisterPage() {
  usePageMeta({ title: 'Open an account · Mynx', description: 'Open a Mynx investment account.' });
  const [submittedEmail, setSubmittedEmail] = useState(null);
  const [params] = useSearchParams();
  // ?ref=CODE from a referral link pre-fills the code. Attribution happens on the server at sign-up.
  const ref = (params.get('ref') ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      accountType: 'INDIVIDUAL',
      firstName: '',
      lastName: '',
      organizationName: '',
      email: '',
      password: '',
      country: 'GH',
      referralCode: ref,
      acceptTerms: false,
    },
  });
  const accountType = form.watch('accountType');
  const errors = form.formState.errors;

  const register = useMutation({
    mutationFn: (values) =>
      api.post('/auth/register', {
        ...values,
        organizationName: values.accountType === 'INSTITUTIONAL' ? values.organizationName : undefined,
        referralCode: values.referralCode || undefined,
      }),
    onSuccess: (_res, values) => setSubmittedEmail(values.email),
    onError: (err) => applyServerErrors(err, form.setError),
  });

  if (submittedEmail) {
    return (
      <AuthCard title="Check your email">
        <div className="flex flex-col items-center text-center">
          <div className="rounded-full bg-brand-50 p-3 text-brand-700">
            <MailCheck className="size-6" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm text-ink-muted">
            If <span className="font-medium text-ink">{submittedEmail}</span> can be used for a new account, we have sent a link to confirm
            it. The link expires in 24 hours.
          </p>
          <Link to="/login" className="mt-6 text-sm font-medium text-brand-700 hover:underline">
            Go to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Open an account"
      description="It takes a couple of minutes. You will verify your identity before investing."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {register.error && !register.error.details && (
        <Alert tone="danger" className="mb-4">
          {register.error.message}
        </Alert>
      )}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((values) => register.mutate(values))}>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">Account type</legend>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['INDIVIDUAL', 'Individual', 'Investing for yourself'],
              ['INSTITUTIONAL', 'Organisation', 'Company, fund or trust'],
            ].map(([value, label, hint]) => (
              <label
                key={value}
                className={cn(
                  'cursor-pointer rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600',
                  accountType === value ? 'border-brand-600 bg-brand-50' : 'border-border-strong hover:bg-surface-muted',
                )}
              >
                <input type="radio" value={value} className="sr-only" {...form.register('accountType')} />
                <span className="block font-medium text-ink">{label}</span>
                <span className="block text-xs text-ink-muted">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {accountType === 'INSTITUTIONAL' && (
          <Field label="Organisation name" error={errors.organizationName?.message} required>
            {(p) => <Input autoComplete="organization" {...p} {...form.register('organizationName')} />}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={accountType === 'INSTITUTIONAL' ? 'Your first name' : 'First name'} error={errors.firstName?.message} required>
            {(p) => <Input autoComplete="given-name" {...p} {...form.register('firstName')} />}
          </Field>
          <Field label={accountType === 'INSTITUTIONAL' ? 'Your last name' : 'Last name'} error={errors.lastName?.message} required>
            {(p) => <Input autoComplete="family-name" {...p} {...form.register('lastName')} />}
          </Field>
        </div>
        <Field label="Email address" error={errors.email?.message} required>
          {(p) => <Input type="email" autoComplete="email" {...p} {...form.register('email')} />}
        </Field>
        <Field label="Password" hint={PASSWORD_HINT} error={errors.password?.message} required>
          {(p) => <PasswordInput autoComplete="new-password" {...p} {...form.register('password')} />}
        </Field>
        <Field label="Country of residence" error={errors.country?.message} required>
          {(p) => <Select options={COUNTRIES} {...p} {...form.register('country')} />}
        </Field>
        <Field label="Referral code (optional)" error={errors.referralCode?.message}>
          {(p) => <Input autoComplete="off" className="uppercase" {...p} {...form.register('referralCode')} />}
        </Field>

        <div>
          <label className="flex items-start gap-3 text-sm text-ink-muted">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-border-strong accent-brand-600"
              {...form.register('acceptTerms')}
              aria-invalid={errors.acceptTerms ? true : undefined}
            />
            <span>
              I have read the{' '}
              <Link to="/risk-disclosures" target="_blank" className="font-medium text-brand-700 underline">
                risk disclosures
              </Link>{' '}
              and understand that investing involves risk, including loss of capital.
            </span>
          </label>
          {errors.acceptTerms && (
            <p role="alert" className="mt-1 text-xs font-medium text-danger">
              {errors.acceptTerms.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" loading={register.isPending}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
