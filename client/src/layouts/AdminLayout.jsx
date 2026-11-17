import { Navigate } from 'react-router';
import {
  ArrowRightLeft,
  Banknote,
  BookOpen,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  Gift,
  KeyRound,
  Landmark,
  LineChart,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  Package,
  ScrollText,
  Settings,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { AppShell } from './AppShell.jsx';
import { UserMenu } from '../components/brand/UserMenu.jsx';
import { useSession } from '../features/auth/useSession.js';

/**
 * Administration shell (dark sidebar, so staff can tell at a glance they are
 * in the back office). Navigation is filtered by the server-issued permissions.
 * The API enforces every permission regardless of what is shown.
 */
export const ADMIN_NAV = [
  { to: '/admin/overview', label: 'Overview', icon: LayoutDashboard, permission: 'admin:dashboard' },
  { to: '/admin/approvals', label: 'Approvals', icon: CheckSquare, permission: 'admin:dashboard' },
  { to: '/admin/kyc', label: 'KYC review', icon: ClipboardCheck, permission: 'kyc:read:any' },
  { to: '/admin/payments', label: 'Payments', icon: Banknote, permission: 'withdrawals:read:any' },
  { to: '/admin/orders', label: 'Orders', icon: ClipboardList, permission: 'investments:orders:read:any' },
  { to: '/admin/products', label: 'Products', icon: Package, permission: 'products:read:any' },
  { to: '/admin/ledger', label: 'Ledger', icon: BookOpen, permission: 'ledger:read' },
  { to: '/admin/support', label: 'Support', icon: LifeBuoy, permission: 'support:tickets:read:any' },
  { to: '/admin/referrals', label: 'Referrals', icon: Gift, permission: 'referrals:manage' },
  { to: '/admin/compliance', label: 'Compliance', icon: ShieldAlert, permission: 'compliance:cases:read' },
  { to: '/admin/users', label: 'Users', icon: Users, permission: 'users:read:any' },
  { to: '/admin/roles', label: 'Roles & permissions', icon: KeyRound, permission: 'roles:read' },
  { to: '/admin/insights', label: 'Insights', icon: LineChart, permission: 'reports:read' },
  { to: '/admin/reports', label: 'Reports', icon: FileBarChart, permission: 'reports:read' },
  { to: '/admin/fx', label: 'Currencies', icon: ArrowRightLeft, permission: 'fx:manage' },
  { to: '/admin/tax', label: 'Tax rules', icon: Landmark, permission: 'reports:read' },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText, permission: 'audit:read' },
  { to: '/admin/messages', label: 'Messages', icon: Mail, permission: 'notifications:manage' },
  { to: '/admin/settings', label: 'Settings', icon: Settings, permission: 'settings:read' },
];

/** /admin lands on the first section this staff member can use. */
export function AdminIndexRedirect() {
  const { data: session } = useSession();
  const first = ADMIN_NAV.find((item) => session?.permissions?.includes(item.permission));
  return <Navigate to={first?.to ?? '/app/security'} replace />;
}

export function AdminLayout() {
  const { data: session } = useSession();
  const permissions = session?.permissions ?? [];
  const allowed = ADMIN_NAV.filter((item) => !item.permission || permissions.includes(item.permission));
  return <AppShell navItems={allowed} homePath="/admin" areaLabel="Admin" tone="dark" headerRight={<UserMenu />} />;
}
