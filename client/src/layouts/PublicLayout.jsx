import { useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router';
import { Menu, X } from 'lucide-react';
import { Logo } from '../components/brand/Logo.jsx';
import { SandboxBanner } from '../components/brand/SandboxBanner.jsx';
import { cn } from '../utils/format.js';
import { useSession } from '../features/auth/useSession.js';

/** Sign-in / account actions, driven by the server session. */
function AuthActions({ onNavigate, stacked = false }) {
  const { data: session } = useSession();
  const signedIn = session && !session.session.mfaPending;
  return (
    <div className={cn('flex gap-2', stacked && 'flex-col pt-2')}>
      {signedIn ? (
        <Link
          to="/app"
          onClick={onNavigate}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800"
        >
          My account
        </Link>
      ) : (
        <>
          <Link
            to="/login"
            onClick={onNavigate}
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            Sign in
          </Link>
          <Link
            to="/register"
            onClick={onNavigate}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800"
          >
            Open an account
          </Link>
        </>
      )}
    </div>
  );
}

/**
 * Public website shell. Navigation lists only pages that exist. Each phase
 * adds its pages here.
 */
export const PUBLIC_NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/investments', label: 'Investments' },
  { to: '/calculator', label: 'Calculator' },
  { to: '/risk-disclosures', label: 'Risk disclosures' },
  { to: '/status', label: 'System status' },
];

export function PublicLayout() {
  const [open, setOpen] = useState(false);
  const linkClass = ({ isActive }) =>
    cn('rounded-md px-3 py-2 text-sm font-medium transition-colors', isActive ? 'text-ink' : 'text-ink-muted hover:text-ink');

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <SandboxBanner />
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {PUBLIC_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden md:block">
            <AuthActions />
          </div>
          <button
            type="button"
            className="rounded-md p-2 text-ink-muted md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" aria-label="Main" className="border-t border-border px-4 py-2 md:hidden">
            {PUBLIC_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={(s) => cn(linkClass(s), 'block')}
              >
                {item.label}
              </NavLink>
            ))}
            <AuthActions stacked onNavigate={() => setOpen(false)} />
          </nav>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-navy-950 text-white/70">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <div className="flex flex-col justify-between gap-6 md:flex-row">
            <Logo inverted />
            <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {PUBLIC_NAV.map((item) => (
                <Link key={item.to} to={item.to} className="hover:text-white">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <p className="mt-8 max-w-3xl text-xs leading-relaxed text-white/60">
            Investing involves risk, including the possible loss of capital. The value of investments can fall as well as rise, and past
            performance is not a reliable indicator of future results. Nothing on this site is investment advice. Mynx is not yet offering
            regulated investment services: this environment is a sandbox and no real money is accepted.
          </p>
          <p className="mt-4 text-xs text-white/40">© {new Date().getFullYear()} Mynx</p>
        </div>
      </footer>
    </div>
  );
}
