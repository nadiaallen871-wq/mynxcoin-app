import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Menu, X } from 'lucide-react';
import { Logo } from '../components/brand/Logo.jsx';
import { SandboxBanner } from '../components/brand/SandboxBanner.jsx';
import { cn } from '../utils/format.js';

/**
 * Shared authenticated shell: a sidebar on desktop and a slide-over on mobile.
 * InvestorLayout and AdminLayout configure it with their own navigation and accent.
 * `navItems`: [{ to, label, icon }]. Admin nav items are filtered by the
 * permissions the server returns. The server still enforces every permission.
 */
export function AppShell({ navItems, homePath, areaLabel, tone = 'light', headerRight, children }) {
  const [open, setOpen] = useState(false);
  const dark = tone === 'dark';

  const nav = (
    <nav aria-label={`${areaLabel} navigation`} className="space-y-0.5 px-3 py-4">
      {navItems.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              dark
                ? isActive
                  ? 'bg-white/10 text-white'
                  : 'text-white/70 hover:bg-white/5 hover:text-white'
                : isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
            )
          }
        >
          {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const sidebarClass = cn('flex w-64 flex-col', dark ? 'bg-navy-950' : 'border-r border-border bg-surface');

  return (
    <div className="flex min-h-dvh flex-col">
      <SandboxBanner />
      <div className="flex flex-1">
        <aside className={cn(sidebarClass, 'hidden lg:flex')}>
          <div className="flex h-16 items-center gap-2 px-6">
            <Logo to={homePath} inverted={dark} />
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase',
                dark ? 'bg-white/10 text-white/70' : 'bg-surface-muted text-ink-subtle',
              )}
            >
              {areaLabel}
            </span>
          </div>
          {nav}
        </aside>

        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-navy-950/50"
              onClick={() => setOpen(false)}
            />
            <aside className={cn(sidebarClass, 'relative h-full animate-fade-in')}>
              <div className="flex h-16 items-center justify-between px-6">
                <Logo to={homePath} inverted={dark} />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close navigation"
                  className={dark ? 'text-white/70' : 'text-ink-muted'}
                >
                  <X className="size-5" />
                </button>
              </div>
              {nav}
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
            <button
              type="button"
              className="rounded-md p-2 text-ink-muted lg:hidden"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            <div className="ml-auto flex items-center gap-3">{headerRight}</div>
          </header>
          <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">{children ?? <Outlet />}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
