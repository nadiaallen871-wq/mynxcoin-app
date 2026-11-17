import {
  BadgeCheck,
  Briefcase,
  FileText,
  Gift,
  LayoutDashboard,
  LifeBuoy,
  ReceiptText,
  Search,
  ShieldCheck,
  User,
  Wallet,
} from 'lucide-react';
import { Navigate } from 'react-router';
import { NotificationBell } from '../components/brand/NotificationBell.jsx';
import { isStaff, useSession } from '../features/auth/useSession.js';
import { AppShell } from './AppShell.jsx';
import { UserMenu } from '../components/brand/UserMenu.jsx';

/**
 * Investor application shell (light theme). Navigation lists only pages that
 * exist.
 */
export const INVESTOR_NAV = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/investments', label: 'Portfolio', icon: Briefcase },
  { to: '/app/wallet', label: 'Wallet', icon: Wallet },
  { to: '/app/transactions', label: 'Transactions', icon: ReceiptText },
  { to: '/investments', label: 'Marketplace', icon: Search },
  { to: '/app/documents', label: 'Documents', icon: FileText },
  { to: '/app/referrals', label: 'Refer a friend', icon: Gift },
  { to: '/app/support', label: 'Support', icon: LifeBuoy },
  { to: '/app/verification', label: 'Verification', icon: BadgeCheck },
  { to: '/app/profile', label: 'Profile', icon: User },
  { to: '/app/security', label: 'Security', icon: ShieldCheck },
];

/** /app lands on the dashboard for investors and on the back office for staff. */
export function AppIndexRedirect() {
  const { data: session } = useSession();
  return <Navigate to={isStaff(session) ? '/admin' : '/app/dashboard'} replace />;
}

export function InvestorLayout() {
  return (
    <AppShell
      navItems={INVESTOR_NAV}
      homePath="/app"
      areaLabel="Account"
      tone="light"
      headerRight={
        <div className="flex items-center gap-1">
          <NotificationBell />
          <UserMenu />
        </div>
      }
    />
  );
}
