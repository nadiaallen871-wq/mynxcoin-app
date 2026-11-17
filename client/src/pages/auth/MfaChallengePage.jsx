import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Field, Input, Spinner } from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { SESSION_KEY, useLogout, useSession } from '../../features/auth/useSession.js';
import { AuthCard, safeNext } from '../../features/auth/AuthCard.jsx';
import { usePageMeta } from '../../hooks/usePageMeta.js';

export default function MfaChallengePage() {
  usePageMeta({ title: 'Two-factor verification · Mynx' });
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session, isPending } = useSession();
  const logout = useLogout();
  const [mode, setMode] = useState('code');
  const [value, setValue] = useState('');

  const verify = useMutation({
    mutationFn: () => api.post('/auth/mfa/verify', mode === 'code' ? { code: value.replace(/\s/g, '') } : { recoveryCode: value.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: SESSION_KEY });
      navigate(next, { replace: true });
    },
    onError: (err) => {
      setValue('');
      if (err.code === 'MFA_LOCKED') {
        qc.setQueryData(SESSION_KEY, null);
        navigate('/login?reason=mfa_locked', { replace: true });
      }
    },
  });

  if (isPending) return <Spinner className="m-auto flex justify-center py-24" />;
  if (!session) return <Navigate to="/login" replace />;
  if (!session.session.mfaPending) return <Navigate to={next} replace />;

  return (
    <AuthCard
      title="Two-factor verification"
      description={
        mode === 'code'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of the recovery codes you saved when you set up two-factor authentication. Each code works once.'
      }
      footer={
        <button
          type="button"
          className="font-medium text-brand-700 hover:underline"
          onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login') })}
        >
          Sign in with a different account
        </button>
      }
    >
      {verify.error && verify.error.code !== 'MFA_LOCKED' && (
        <Alert tone="danger" className="mb-4">
          {verify.error.message}
        </Alert>
      )}
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) verify.mutate();
        }}
      >
        <Field label={mode === 'code' ? 'Authentication code' : 'Recovery code'} required>
          {(p) =>
            mode === 'code' ? (
              <Input
                {...p}
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="tabular text-center text-lg tracking-[0.4em]"
                autoFocus
              />
            ) : (
              <Input
                {...p}
                value={value}
                onChange={(e) => setValue(e.target.value.slice(0, 20))}
                autoComplete="off"
                placeholder="ABCDE-FGHIJ"
                className="font-mono uppercase"
                autoFocus
              />
            )
          }
        </Field>
        <Button type="submit" className="w-full" loading={verify.isPending}>
          Verify
        </Button>
      </form>
      <button
        type="button"
        className="mt-4 w-full text-center text-sm font-medium text-brand-700 hover:underline"
        onClick={() => {
          setMode(mode === 'code' ? 'recovery' : 'code');
          setValue('');
          verify.reset();
        }}
      >
        {mode === 'code' ? 'Use a recovery code instead' : 'Use my authenticator app instead'}
      </button>
    </AuthCard>
  );
}
