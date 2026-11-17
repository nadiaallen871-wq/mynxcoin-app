import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronDown, LayoutDashboard, LogOut, ShieldCheck, User } from 'lucide-react';
import { displayName, hasPermission, useLogout, useSession } from '../../features/auth/useSession.js';

/** Account menu in the app header: profile, security, admin console (staff) and sign out. */
export function UserMenu() {
  const { data: session } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!session) return null;
  const name = displayName(session);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const item = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-surface-muted';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${name}`}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted"
      >
        <span
          className="flex size-8 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white"
          aria-hidden="true"
        >
          {initials}
        </span>
        <span className="hidden max-w-40 truncate font-medium text-ink sm:block">{name}</span>
        <ChevronDown className="size-4 text-ink-subtle" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-60 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-overlay"
        >
          <p className="truncate px-3 py-2 text-xs text-ink-subtle">{session.user.email}</p>
          <Link role="menuitem" to="/app/profile" className={item} onClick={() => setOpen(false)}>
            <User className="size-4" aria-hidden="true" /> Profile
          </Link>
          <Link role="menuitem" to="/app/security" className={item} onClick={() => setOpen(false)}>
            <ShieldCheck className="size-4" aria-hidden="true" /> Security
          </Link>
          {hasPermission(session, 'admin:dashboard') && (
            <Link role="menuitem" to="/admin" className={item} onClick={() => setOpen(false)}>
              <LayoutDashboard className="size-4" aria-hidden="true" /> Admin console
            </Link>
          )}
          <div className="my-1 border-t border-border" />
          <button
            role="menuitem"
            type="button"
            className={item}
            onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })}
          >
            <LogOut className="size-4" aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
