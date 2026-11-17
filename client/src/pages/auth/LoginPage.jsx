import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Field, Input } from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { SESSION_KEY } from '../../features/auth/useSession.js';
import { AuthCard, PasswordInput, safeNext } from '../../features/auth/AuthCard.jsx';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export default function LoginPage() {
  usePageMeta({ title: 'Sign in · Mynx' });
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const next = safeNext(params.get('next'));
  const [resent, setResent] = useState(false);

  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  const login = useMutation({
    mutationFn: (values) => api.post('/auth/login', values),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: SESSION_KEY });
      navigate(res.data.mfaRequired ? `/login/verify?next=${encodeURIComponent(next)}` : next, { replace: true });
    },
  });
  const resend = useMutation({
    mutationFn: () => api.post('/auth/resend-verification', { email: form.getValues('email') }),
    onSuccess: () => setResent(true),
  });

  const error = login.error;
  const reason = params.get('reason');

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to manage your account."
      footer={
        <>
          New to Mynx?{' '}
          <Link to="/register" className="font-medium text-brand-700 hover:underline">
            Open an account
          </Link>
        </>
      }
    >
      {reason === 'mfa_locked' && (
        <Alert tone="warning" className="mb-4">
          Too many incorrect codes. Sign in again to get a new challenge.
        </Alert>
      )}
      {reason === 'reset' && (
        <Alert tone="success" className="mb-4">
          Your password was updated. Sign in with your new password.
        </Alert>
      )}
      {error && error.code !== 'EMAIL_NOT_VERIFIED' && (
        <Alert tone="danger" className="mb-4">
          {error.message}
        </Alert>
      )}
      {error?.code === 'EMAIL_NOT_VERIFIED' && (
        <Alert tone="warning" title="Confirm your email first" className="mb-4">
          {resent ? (
            'If the account exists and is unconfirmed, a new link is on its way.'
          ) : (
            <>
              We sent a confirmation link when you registered.{' '}
              <button
                type="button"
                className="font-medium text-brand-700 underline"
                onClick={() => resend.mutate()}
                disabled={resend.isPending}
              >
                Send a new link
              </button>
            </>
          )}
        </Alert>
      )}

      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((values) => login.mutate(values))}>
        <Field label="Email address" error={form.formState.errors.email?.message} required>
          {(p) => <Input type="email" autoComplete="email" autoFocus {...p} {...form.register('email')} />}
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message} required>
          {(p) => <PasswordInput autoComplete="current-password" {...p} {...form.register('password')} />}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
