import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '../../services/api.js';

/** Header bell with the unread count. Polls every minute while the tab is open. */
export function NotificationBell() {
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get('/notifications/unread-count').then((r) => r.data.count),
    refetchInterval: 60_000,
  });
  const count = unread.data ?? 0;
  return (
    <Link
      to="/app/notifications"
      className="relative inline-flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink"
      aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
    >
      <Bell className="size-5" aria-hidden="true" />
      {count > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white"
          aria-hidden="true"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
