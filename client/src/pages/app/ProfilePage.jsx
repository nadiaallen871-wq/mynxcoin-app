import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input } from '../../components/ui/index.js';
import { PageHeader } from '../../layouts/AppShell.jsx';
import { api, applyServerErrors } from '../../services/api.js';
import { useRefreshSession, useSession } from '../../features/auth/useSession.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Required').max(100),
  lastName: z.string().trim().min(1, 'Required').max(100),
  organizationName: z.string().trim().max(200).optional(),
});

function ProfileForm({ session }) {
  const toast = useToast();
  const refresh = useRefreshSession();
  const institutional = session.user.type === 'INSTITUTIONAL';
  const form = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: session.profile?.firstName ?? '',
      lastName: session.profile?.lastName ?? '',
      organizationName: session.profile?.organizationName ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (values) => api.patch('/users/me', institutional ? values : { firstName: values.firstName, lastName: values.lastName }),
    onSuccess: async (res) => {
      form.reset(res.data);
      await refresh();
      toast.success('Profile updated');
    },
    onError: (err) => applyServerErrors(err, form.setError) || toast.error('Could not save profile', err.message),
  });
  const errors = form.formState.errors;

  return (
    <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      {institutional && (
        <Field label="Organisation name" error={errors.organizationName?.message}>
          {(p) => <Input {...p} {...form.register('organizationName')} />}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={errors.firstName?.message} required>
          {(p) => <Input autoComplete="given-name" {...p} {...form.register('firstName')} />}
        </Field>
        <Field label="Last name" error={errors.lastName?.message} required>
          {(p) => <Input autoComplete="family-name" {...p} {...form.register('lastName')} />}
        </Field>
      </div>
      <p className="text-xs text-ink-subtle">Your legal name must match your identity documents when you complete verification.</p>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

function PhoneVerification({ session }) {
  const toast = useToast();
  const refresh = useRefreshSession();
  const [phone, setPhone] = useState('');
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState('');

  const start = useMutation({
    mutationFn: () => api.post('/users/me/phone', { phone }),
    onSuccess: (res) => {
      setPending(res.data);
      toast.info('Code sent', `We sent a 6-digit code to ${res.data.phone}.`);
    },
  });
  const verify = useMutation({
    mutationFn: () => api.post('/users/me/phone/verify', { code }),
    onSuccess: async () => {
      setPending(null);
      setCode('');
      setPhone('');
      await refresh();
      toast.success('Phone number verified');
    },
  });

  return (
    <div className="space-y-4">
      {session.user.phoneVerified && (
        <p className="flex items-center gap-2 text-sm text-ink">
          <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          <span className="tabular font-medium">{session.user.phone}</span>
          <Badge tone="success">Verified</Badge>
        </p>
      )}
      {!pending ? (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <Field
            label={session.user.phoneVerified ? 'Change phone number' : 'Mobile number'}
            hint="e.g. 024 123 4567 or +233241234567"
            error={start.error?.message}
            className="flex-1"
          >
            {(p) => <Input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} {...p} />}
          </Field>
          <Button type="submit" variant="secondary" loading={start.isPending} disabled={phone.trim().length < 9}>
            Send code
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate();
          }}
        >
          <Field
            label={`Code sent to ${pending.phone}`}
            hint={`Expires ${formatDateTime(pending.expiresAt)}`}
            error={verify.error?.message}
            className="flex-1"
          >
            {(p) => (
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="tabular tracking-widest"
                {...p}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={verify.isPending} disabled={code.length !== 6}>
              Verify
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function ProfilePage() {
  usePageMeta({ title: 'Profile · Mynx' });
  const { data: session } = useSession();
  if (!session) return null;
  return (
    <>
      <PageHeader title="Profile" description="Your personal details and contact information." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Personal details" />
            <CardBody>
              <ProfileForm session={session} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Phone number" description="Used for security codes and important account alerts." />
            <CardBody>
              <PhoneVerification session={session} />
            </CardBody>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="Account" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-ink-subtle">Email</dt>
                <dd className="mt-0.5 font-medium break-all text-ink">{session.user.email}</dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Account type</dt>
                <dd className="mt-0.5 font-medium text-ink capitalize">{session.user.type.toLowerCase()}</dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Member since</dt>
                <dd className="mt-0.5 font-medium text-ink">{formatDateTime(session.user.createdAt)}</dd>
              </div>
            </dl>
            <Alert tone="info" className="mt-4">
              You need to verify your identity before you can invest.{' '}
              <Link to="/app/verification" className="font-medium text-brand-700 underline">
                Go to verification
              </Link>
            </Alert>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
