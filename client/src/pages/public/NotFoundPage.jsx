import { Link } from 'react-router';
import { usePageMeta } from '../../hooks/usePageMeta.js';

export default function NotFoundPage() {
  usePageMeta({ title: 'Page not found · Mynx' });
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <p className="tabular text-sm font-semibold text-brand-700">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-3 text-ink-muted">The page you are looking for doesn’t exist or has moved.</p>
      <Link
        to="/"
        className="mt-8 inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800"
      >
        Back to home
      </Link>
    </div>
  );
}
