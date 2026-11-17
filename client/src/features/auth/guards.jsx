import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { useSession, hasPermission } from './useSession.js';
import { Card, EmptyState, ErrorState, Spinner } from '../../components/ui/index.js';

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label="Loading your account" />
    </div>
  );
}

/** Signed-in users only. MFA-pending sessions are sent to the challenge step. */
export function RequireAuth({ children }) {
  const { data: session, isPending, isError, error, refetch } = useSession();
  const location = useLocation();
  if (isPending) return <FullPageSpinner />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  const next = encodeURIComponent(location.pathname + location.search);
  if (!session) return <Navigate to={`/login?next=${next}`} replace />;
  if (session.session.mfaPending) return <Navigate to={`/login/verify?next=${next}`} replace />;
  return children ?? <Outlet />;
}

/** Hides staff areas from users without the permission. The API enforces it regardless. */
export function RequirePermission({ permission, children }) {
  const { data: session } = useSession();
  // Mirrors the server rule: staff permissions need an MFA-verified session.
  const staffPermission = !permission.endsWith(':own');
  if (hasPermission(session, permission) && (!staffPermission || session.session.mfaVerified)) return children ?? <Outlet />;
  if (hasPermission(session, permission)) {
    return (
      <Card className="mx-auto max-w-lg">
        <EmptyState
          icon={ShieldAlert}
          title="Two-factor authentication required"
          description="Staff tools are available only after you enable two-factor authentication on your account."
          action={
            <Link to="/app/security" className="text-sm font-medium text-brand-700 hover:underline">
              Go to security settings
            </Link>
          }
        />
      </Card>
    );
  }
  return (
    <Card className="mx-auto max-w-lg">
      <EmptyState icon={ShieldAlert} title="You don’t have access to this page" description="Ask an administrator if you need access." />
    </Card>
  );
}

/** Pages for signed-out visitors only (login, register). Signed-in users go to their account. */
export function RedirectIfSignedIn({ children }) {
  const { data: session, isPending } = useSession();
  if (isPending) return <FullPageSpinner />;
  if (session && !session.session.mfaPending) return <Navigate to="/app" replace />;
  return children;
}
