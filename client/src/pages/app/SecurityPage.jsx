import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { Copy, KeyRound, Laptop, ShieldCheck, ShieldOff } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Field,
  Input,
  Modal,
  Skeleton,
} from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api, applyServerErrors } from '../../services/api.js';
import { useRefreshSession, useSession } from '../../features/auth/useSession.js';
import { PASSWORD_HINT, PasswordInput } from '../../features/auth/AuthCard.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(12, 'Use at least 12 characters').max(128),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

function ChangePassword() {
  const toast = useToast();
  const qc = useQueryClient();
  const form = useForm({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }) => api.post('/auth/password', { currentPassword, newPassword }),
    onSuccess: () => {
      form.reset();
      qc.invalidateQueries({ queryKey: ['account', 'sessions'] });
      toast.success('Password changed', 'Your other devices were signed out.');
    },
    onError: (err) => applyServerErrors(err, form.setError) || toast.error('Could not change password', err.message),
  });
  const e = form.formState.errors;
  return (
    <form className="max-w-md space-y-4" noValidate onSubmit={form.handleSubmit((v) => change.mutate(v))}>
      <Field label="Current password" error={e.currentPassword?.message} required>
        {(p) => <PasswordInput autoComplete="current-password" {...p} {...form.register('currentPassword')} />}
      </Field>
      <Field label="New password" hint={PASSWORD_HINT} error={e.newPassword?.message} required>
        {(p) => <PasswordInput autoComplete="new-password" {...p} {...form.register('newPassword')} />}
      </Field>
      <Field label="Confirm new password" error={e.confirm?.message} required>
        {(p) => <PasswordInput autoComplete="new-password" {...p} {...form.register('confirm')} />}
      </Field>
      <Button type="submit" loading={change.isPending}>
        Change password
      </Button>
    </form>
  );
}

function QrCode({ value }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [value]);
  // The SVG is generated locally from our own otpauth URL. No user input reaches it.
  return (
    <div
      className="size-44 rounded-lg border border-border bg-white p-1"
      role="img"
      aria-label="QR code for your authenticator app"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function RecoveryCodes({ codes, onDone }) {
  const toast = useToast();
  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Save these recovery codes now">
        Each code signs you in once if you lose access to your authenticator app. They will not be shown again.
      </Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-lg bg-surface-muted p-4 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex justify-between gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            navigator.clipboard.writeText(codes.join('\n')).then(
              () => toast.success('Copied to clipboard'),
              () => toast.error('Copy failed'),
            )
          }
        >
          <Copy className="size-4" aria-hidden="true" /> Copy codes
        </Button>
        <Button onClick={onDone}>I have saved them</Button>
      </div>
    </div>
  );
}

function EnableMfa({ onEnabled }) {
  const [step, setStep] = useState('password');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const refresh = useRefreshSession();

  const start = useMutation({
    mutationFn: () => api.post('/auth/mfa/setup', { password }),
    onSuccess: (res) => {
      setSetup(res.data);
      setPassword('');
      setStep('scan');
    },
  });
  const enable = useMutation({
    mutationFn: () => api.post('/auth/mfa/enable', { code }),
    onSuccess: (res) => {
      setCodes(res.data.recoveryCodes);
      setStep('codes');
    },
    onError: () => setCode(''),
  });

  if (step === 'codes') {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={async () => {
          await refresh();
          onEnabled();
        }}
      />
    );
  }
  if (step === 'scan') {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enable.mutate();
        }}
      >
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
          <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
          <li>Scan the QR code, or enter the key manually.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <QrCode value={setup.otpauthUrl} />
          <div className="text-sm">
            <p className="text-ink-subtle">Manual entry key</p>
            <p className="mt-1 font-mono break-all text-ink">{setup.secret.match(/.{1,4}/g).join(' ')}</p>
          </div>
        </div>
        <Field label="6-digit code" error={enable.error?.message}>
          {(p) => (
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="tabular max-w-40 tracking-widest"
              {...p}
            />
          )}
        </Field>
        <Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>
          Turn on two-factor authentication
        </Button>
      </form>
    );
  }
  return (
    <form
      className="max-w-md space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start.mutate();
      }}
    >
      <p className="text-sm text-ink-muted">Confirm your password to start setting up two-factor authentication.</p>
      <Field label="Password" error={start.error?.details?.[0]?.message ?? start.error?.message}>
        {(p) => <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} {...p} />}
      </Field>
      <Button type="submit" loading={start.isPending} disabled={!password}>
        Continue
      </Button>
    </form>
  );
}

/** Password plus a current code (or recovery code). Used to disable MFA or regenerate codes. */
function StepUpModal({ open, title, confirmLabel, tone, onClose, endpoint, onSuccess }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.post(endpoint, /^\d{6}$/.test(code) ? { password, code } : { password, recoveryCode: code }),
    onSuccess: (res) => {
      setPassword('');
      setCode('');
      onSuccess(res);
    },
  });
  const close = () => {
    mutation.reset();
    setPassword('');
    setCode('');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={mutation.isPending}
            disabled={!password || code.length < 6}
            onClick={() => mutation.mutate()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {mutation.error && <Alert tone="danger">{mutation.error.details?.[0]?.message ?? mutation.error.message}</Alert>}
        <Field label="Password">
          {(p) => <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} {...p} />}
        </Field>
        <Field label="Authentication code or recovery code">
          {(p) => <Input autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.trim().slice(0, 20))} {...p} />}
        </Field>
      </div>
    </Modal>
  );
}

function TwoFactor({ session }) {
  const toast = useToast();
  const refresh = useRefreshSession();
  const [enrolling, setEnrolling] = useState(false);
  const [modal, setModal] = useState(null);
  const [newCodes, setNewCodes] = useState(null);
  const mfa = session.mfa;

  if (newCodes) return <RecoveryCodes codes={newCodes} onDone={() => setNewCodes(null)} />;
  if (!mfa?.enabled) {
    return enrolling ? (
      <EnableMfa
        onEnabled={() => {
          setEnrolling(false);
          toast.success('Two-factor authentication is on');
        }}
      />
    ) : (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-3 text-sm text-ink-muted">
          <ShieldOff className="size-5 shrink-0 text-warning" aria-hidden="true" />
          {session.user.type === 'STAFF'
            ? 'Required for staff: the admin console stays locked until you turn this on.'
            : 'Protect your account with a code from your phone in addition to your password.'}
        </p>
        <Button onClick={() => setEnrolling(true)}>Set up</Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <ShieldCheck className="size-5 text-success" aria-hidden="true" />
        <span className="font-medium text-ink">Authenticator app</span>
        <Badge tone="success">On</Badge>
        <span className="text-ink-subtle">since {formatDateTime(mfa.enabledAt)}</span>
      </div>
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <KeyRound className="size-4" aria-hidden="true" />
        <span className="tabular">{mfa.recoveryCodesRemaining}</span> unused recovery codes
        {mfa.recoveryCodesRemaining <= 3 && <Badge tone="warning">Running low</Badge>}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setModal('codes')}>
          Generate new recovery codes
        </Button>
        <Button variant="ghost" className="text-danger" onClick={() => setModal('disable')}>
          Turn off
        </Button>
      </div>
      <StepUpModal
        open={modal === 'codes'}
        title="Generate new recovery codes"
        confirmLabel="Generate codes"
        endpoint="/auth/mfa/recovery-codes"
        onClose={() => setModal(null)}
        onSuccess={async (res) => {
          setModal(null);
          setNewCodes(res.data.recoveryCodes);
          await refresh();
        }}
      />
      <StepUpModal
        open={modal === 'disable'}
        title="Turn off two-factor authentication?"
        confirmLabel="Turn off"
        tone="danger"
        endpoint="/auth/mfa/disable"
        onClose={() => setModal(null)}
        onSuccess={async () => {
          setModal(null);
          await refresh();
          toast.info('Two-factor authentication is off');
        }}
      />
    </div>
  );
}

function Sessions() {
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const sessions = useQuery({ queryKey: ['account', 'sessions'], queryFn: () => api.get('/users/me/sessions').then((r) => r.data) });
  const revoke = useMutation({
    mutationFn: (id) => api.delete(`/users/me/sessions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account', 'sessions'] });
      toast.success('Device signed out');
    },
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.post('/users/me/sessions/revoke-others'),
    onSuccess: (res) => {
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ['account', 'sessions'] });
      toast.success(`Signed out ${res.data.revoked} other device${res.data.revoked === 1 ? '' : 's'}`);
    },
  });

  if (sessions.isPending) return <Skeleton className="m-5 h-24" />;
  if (sessions.isError) return <ErrorState error={sessions.error} onRetry={sessions.refetch} />;
  return (
    <>
      <DataTable
        caption="Active sessions"
        rows={sessions.data}
        columns={[
          {
            key: 'device',
            header: 'Device',
            render: (s) => (
              <span className="flex items-start gap-2">
                <Laptop className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                <span>
                  <span className="block max-w-xs truncate" title={s.userAgent ?? ''}>
                    {s.userAgent ?? 'Unknown device'}
                  </span>
                  <span className="text-xs text-ink-subtle">{s.ipAddress ?? 'Unknown IP'}</span>
                </span>
              </span>
            ),
          },
          { key: 'lastSeenAt', header: 'Last active', render: (s) => formatDateTime(s.lastSeenAt) },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (s) =>
              s.current ? (
                <Badge tone="info">This device</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoke.mutate(s.id)}
                  loading={revoke.isPending && revoke.variables === s.id}
                >
                  Sign out
                </Button>
              ),
          },
        ]}
      />
      {sessions.data.length > 1 && (
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
            Sign out all other devices
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => revokeOthers.mutate()}
        loading={revokeOthers.isPending}
        title="Sign out other devices?"
        confirmLabel="Sign out others"
      >
        Every device except this one will need to sign in again.
      </ConfirmDialog>
    </>
  );
}

const REASONS = {
  OK: 'Signed in',
  MFA_PENDING: 'Password accepted',
  BAD_PASSWORD: 'Wrong password',
  LOCKED: 'Blocked (locked)',
  NOT_VERIFIED: 'Email not confirmed',
  DISABLED: 'Account inactive',
  MFA_FAILED: 'Wrong 2FA code',
};

function LoginHistory() {
  const history = useQuery({
    queryKey: ['account', 'login-history'],
    queryFn: () => api.get('/users/me/login-history').then((r) => r.data),
  });
  if (history.isPending) return <Skeleton className="m-5 h-24" />;
  if (history.isError) return <ErrorState error={history.error} onRetry={history.refetch} />;
  return (
    <DataTable
      caption="Recent sign-in activity"
      rows={history.data}
      columns={[
        { key: 'createdAt', header: 'Time', render: (h) => formatDateTime(h.createdAt) },
        {
          key: 'result',
          header: 'Result',
          render: (h) => <Badge tone={h.success ? 'success' : 'danger'}>{REASONS[h.reason] ?? h.reason}</Badge>,
        },
        { key: 'ipAddress', header: 'IP address', render: (h) => <span className="font-mono text-xs">{h.ipAddress ?? '—'}</span> },
      ]}
    />
  );
}

export default function SecurityPage() {
  usePageMeta({ title: 'Security · Mynx' });
  const { data: session } = useSession();
  if (!session) return null;
  return (
    <>
      <PageHeader title="Security" description="Manage how you sign in and which devices have access to your account." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Two-factor authentication" description="A second step at sign-in using an authenticator app." />
          <CardBody>
            <TwoFactor session={session} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Password" description="Changing your password signs out your other devices." />
          <CardBody>
            <ChangePassword />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Active sessions" description="Devices currently signed in to your account." />
          <Sessions />
        </Card>
        <Card>
          <CardHeader
            title="Sign-in activity"
            description="The 20 most recent sign-in attempts. If you don’t recognise one, change your password."
          />
          <LoginHistory />
        </Card>
      </div>
    </>
  );
}
