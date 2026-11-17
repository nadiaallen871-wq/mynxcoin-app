import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, MailCheck, XCircle } from 'lucide-react';
import { Alert, Button, Field, Input, Spinner } from '../../components/ui/index.js';
import { api, applyServerErrors } from '../../services/api.js';
import { AuthCard, PASSWORD_HINT, PasswordInput, readTokenFromHash } from '../../features/auth/AuthCard.jsx';
import { usePageMeta } from '../../hooks/usePageMeta.js';

function StatusIcon({ ok }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className={ok ? 'rounded-full bg-success-soft p-3 text-success' : 'rounded-full bg-danger-soft p-3 text-danger'}>
      <Icon className="size-6" aria-hidden="true" />
    </div>
  );
}

export function VerifyEmailPage() {
  usePageMeta({ title: 'Confirm email · Mynx' });
  const [token] = useState(readTokenFromHash);
  const started = useRef(false);
  const verify = useMutation({ mutationFn: () => api.post('/auth/verify-email', { token }) });

  useEffect(() => {
    // Guard against StrictMode's double effect: the token is single-use.
    if (token && !started.current) {
      started.current = true;
      verify.mutate();
    }
  }, [token, verify]);

  if (!token || verify.isError) {
    return (
      <AuthCard title="Link not valid">
        <div className="flex flex-col items-center text-center">
          <StatusIcon ok={false} />
          <p className="mt-4 text-sm text-ink-muted">
            {verify.error?.message ?? 'This confirmation link is incomplete.'} Sign in to request a new confirmation email.
          </p>
          <Link to="/login" className="mt-6 text-sm font-medium text-brand-700 hover:underline">
            Go to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }
  if (!verify.isSuccess) return <Spinner label="Confirming your email" className="flex justify-center py-24" />;
  return (
    <AuthCard title="Email confirmed">
      <div className="flex flex-col items-center text-center">
        <StatusIcon ok />
        <p className="mt-4 text-sm text-ink-muted">Your account is active. Sign in to continue setting up your account.</p>
        <Link
          to="/login"
          className="mt-6 inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800"
        >
          Sign in
        </Link>
      </div>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  usePageMeta({ title: 'Reset password · Mynx' });
  const form = useForm({
    resolver: zodResolver(z.object({ email: z.string().trim().email('Enter a valid email address') })),
    defaultValues: { email: '' },
  });
  const request = useMutation({ mutationFn: (values) => api.post('/auth/forgot-password', values) });

  if (request.isSuccess) {
    return (
      <AuthCard title="Check your email">
        <div className="flex flex-col items-center text-center">
          <div className="rounded-full bg-brand-50 p-3 text-brand-700">
            <MailCheck className="size-6" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm text-ink-muted">
            If an account exists for that address, we have sent a link to reset the password. It expires in 30 minutes.
          </p>
          <Link to="/login" className="mt-6 text-sm font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email and we will send you a reset link."
      footer={
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {request.error && (
        <Alert tone="danger" className="mb-4">
          {request.error.message}
        </Alert>
      )}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => request.mutate(v))}>
        <Field label="Email address" error={form.formState.errors.email?.message} required>
          {(p) => <Input type="email" autoComplete="email" autoFocus {...p} {...form.register('email')} />}
        </Field>
        <Button type="submit" className="w-full" loading={request.isPending}>
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}

const resetSchema = z
  .object({ password: z.string().min(12, 'Use at least 12 characters').max(128), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

/** Handles both password reset and staff account setup links. */
export function ResetPasswordPage() {
  usePageMeta({ title: 'Choose a new password · Mynx' });
  const navigate = useNavigate();
  const [token] = useState(readTokenFromHash);
  const form = useForm({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' } });
  const reset = useMutation({
    mutationFn: ({ password }) => api.post('/auth/reset-password', { token, password }),
    onSuccess: () => navigate('/login?reason=reset', { replace: true }),
    onError: (err) => applyServerErrors(err, form.setError, ['password']),
  });

  if (!token) {
    return (
      <AuthCard title="Link not valid">
        <p className="text-sm text-ink-muted">This link is incomplete or has already been used.</p>
        <Link to="/forgot-password" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="After saving, all devices are signed out and you can sign in with the new password."
    >
      {reset.error?.code === 'TOKEN_INVALID' && (
        <Alert tone="danger" className="mb-4">
          {reset.error.message}{' '}
          <Link to="/forgot-password" className="font-medium underline">
            Request a new link
          </Link>
        </Alert>
      )}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => reset.mutate(v))}>
        <Field label="New password" hint={PASSWORD_HINT} error={form.formState.errors.password?.message} required>
          {(p) => <PasswordInput autoComplete="new-password" autoFocus {...p} {...form.register('password')} />}
        </Field>
        <Field label="Confirm new password" error={form.formState.errors.confirm?.message} required>
          {(p) => <PasswordInput autoComplete="new-password" {...p} {...form.register('confirm')} />}
        </Field>
        <Button type="submit" className="w-full" loading={reset.isPending}>
          Save password
        </Button>
      </form>
    </AuthCard>
  );
}
