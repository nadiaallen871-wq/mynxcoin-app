import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/index.js';

/**
 * Route-level error boundary. The most common production cause is a stale
 * code chunk after a new release (the old file no longer exists), which a reload fixes.
 */
export default function RouteError() {
  const error = useRouteError();
  const chunkFailed = /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(String(error?.message ?? ''));
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div role="alert" className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-ink">
          {chunkFailed ? 'A new version is available' : notFound ? 'Page not found' : 'Something went wrong'}
        </h1>
        <p className="mt-2 text-ink-muted">
          {chunkFailed
            ? 'Mynx was updated while this page was open. Reload to continue.'
            : 'Please try again. If the problem continues, contact support.'}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" aria-hidden="true" /> Reload
          </Button>
          <Link
            to="/"
            className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
