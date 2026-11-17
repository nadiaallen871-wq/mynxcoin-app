import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { PublicLayout } from '../layouts/PublicLayout.jsx';
import { AppIndexRedirect, InvestorLayout } from '../layouts/InvestorLayout.jsx';
import { AdminIndexRedirect, AdminLayout } from '../layouts/AdminLayout.jsx';
import { RedirectIfSignedIn, RequireAuth, RequirePermission } from '../features/auth/guards.jsx';
import { Spinner } from '../components/ui/index.js';
import RouteError from '../pages/RouteError.jsx';

const HomePage = lazy(() => import('../pages/public/HomePage.jsx'));
const RiskDisclosuresPage = lazy(() => import('../pages/public/RiskDisclosuresPage.jsx'));
const StatusPage = lazy(() => import('../pages/public/StatusPage.jsx'));
const NotFoundPage = lazy(() => import('../pages/public/NotFoundPage.jsx'));
const MarketplacePage = lazy(() => import('../pages/public/MarketplacePage.jsx'));
const ProductDetailPage = lazy(() => import('../pages/public/ProductDetailPage.jsx'));
const CalculatorPage = lazy(() => import('../pages/public/CalculatorPage.jsx'));

const LoginPage = lazy(() => import('../pages/auth/LoginPage.jsx'));
const MfaChallengePage = lazy(() => import('../pages/auth/MfaChallengePage.jsx'));
const RegisterPage = lazy(() => import('../pages/auth/RegisterPage.jsx'));
const VerifyEmailPage = lazy(() => import('../pages/auth/RecoveryPages.jsx').then((m) => ({ default: m.VerifyEmailPage })));
const ForgotPasswordPage = lazy(() => import('../pages/auth/RecoveryPages.jsx').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('../pages/auth/RecoveryPages.jsx').then((m) => ({ default: m.ResetPasswordPage })));

const ProfilePage = lazy(() => import('../pages/app/ProfilePage.jsx'));
const SecurityPage = lazy(() => import('../pages/app/SecurityPage.jsx'));
const VerificationPage = lazy(() => import('../pages/app/VerificationPage.jsx'));

const UsersPage = lazy(() => import('../pages/admin/UsersPage.jsx'));
const UserDetailPage = lazy(() => import('../pages/admin/UserDetailPage.jsx'));
const RolesPage = lazy(() => import('../pages/admin/RolesPage.jsx'));
const KycQueuePage = lazy(() => import('../pages/admin/KycQueuePage.jsx'));
const KycReviewPage = lazy(() => import('../pages/admin/KycReviewPage.jsx'));
const ProductsPage = lazy(() => import('../pages/admin/ProductsPage.jsx'));
const ProductEditorPage = lazy(() => import('../pages/admin/ProductEditorPage.jsx'));
const LedgerPage = lazy(() => import('../pages/admin/LedgerPage.jsx'));
const WalletPage = lazy(() => import('../pages/app/WalletPage.jsx'));
const DashboardPage = lazy(() => import('../pages/app/DashboardPage.jsx'));
const StatementsPage = lazy(() => import('../pages/app/StatementsPage.jsx'));
const NotificationsPage = lazy(() => import('../pages/app/NotificationsPage.jsx'));
const ReferralsPage = lazy(() => import('../pages/app/ReferralsPage.jsx'));
const SupportPage = lazy(() => import('../pages/app/SupportPage.jsx'));
const SupportTicketPage = lazy(() => import('../pages/app/SupportPage.jsx').then((m) => ({ default: m.SupportTicketPage })));
const HelpPage = lazy(() => import('../pages/public/HelpPage.jsx'));
const SupportDeskPage = lazy(() => import('../pages/admin/SupportDeskPage.jsx'));
const SupportTicketAdminPage = lazy(() =>
  import('../pages/admin/SupportDeskPage.jsx').then((m) => ({ default: m.SupportTicketAdminPage })),
);
const ReferralsAdminPage = lazy(() => import('../pages/admin/ReferralsAdminPage.jsx'));
const OverviewPage = lazy(() => import('../pages/admin/OverviewPage.jsx'));
const FxPage = lazy(() => import('../pages/admin/FxPage.jsx'));
const InsightsPage = lazy(() => import('../pages/admin/InsightsPage.jsx'));
const TaxRulesPage = lazy(() => import('../pages/admin/TaxRulesPage.jsx'));
const ConvertPage = lazy(() => import('../pages/app/ConvertPage.jsx'));
const ApprovalsPage = lazy(() => import('../pages/admin/ApprovalsPage.jsx'));
const SettingsPage = lazy(() => import('../pages/admin/SettingsPage.jsx'));
const AuditPage = lazy(() => import('../pages/admin/AuditPage.jsx'));
const ReportsPage = lazy(() => import('../pages/admin/ReportsPage.jsx'));
const MessagesPage = lazy(() => import('../pages/admin/MessagesPage.jsx'));
const CompliancePage = lazy(() => import('../pages/admin/CompliancePage.jsx'));
const ComplianceCasePage = lazy(() => import('../pages/admin/CompliancePage.jsx').then((m) => ({ default: m.ComplianceCasePage })));
const DepositPage = lazy(() => import('../pages/app/DepositPage.jsx'));
const DepositStatusPage = lazy(() => import('../pages/app/DepositPage.jsx').then((m) => ({ default: m.DepositStatusPage })));
const WithdrawPage = lazy(() => import('../pages/app/WithdrawPage.jsx'));
const TransactionsPage = lazy(() => import('../pages/app/TransactionsPage.jsx'));
const MyInvestmentsPage = lazy(() => import('../pages/app/MyInvestmentsPage.jsx'));
const SandboxCheckoutPage = lazy(() => import('../pages/SandboxCheckoutPage.jsx'));
const PaymentsPage = lazy(() => import('../pages/admin/PaymentsPage.jsx'));
const OrdersPage = lazy(() => import('../pages/admin/OrdersPage.jsx'));

const page = (Component) => (
  <Suspense
    fallback={
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    }
  >
    <Component />
  </Suspense>
);

const guestOnly = (Component) => <RedirectIfSignedIn>{page(Component)}</RedirectIfSignedIn>;
const withPermission = (permission, Component) => <RequirePermission permission={permission}>{page(Component)}</RequirePermission>;

/**
 * Route tree: public website, investor app (/app) and admin console (/admin).
 * The guards are UX only. The API authorises every request on the server.
 */
export const routes = [
  {
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: page(HomePage) },
      { path: 'risk-disclosures', element: page(RiskDisclosuresPage) },
      { path: 'status', element: page(StatusPage) },
      { path: 'investments', element: page(MarketplacePage) },
      { path: 'investments/:slug', element: page(ProductDetailPage) },
      { path: 'calculator', element: page(CalculatorPage) },
      { path: 'help', element: page(HelpPage) },
      { path: 'login', element: guestOnly(LoginPage) },
      { path: 'login/verify', element: page(MfaChallengePage) },
      { path: 'register', element: guestOnly(RegisterPage) },
      { path: 'verify-email', element: page(VerifyEmailPage) },
      { path: 'forgot-password', element: page(ForgotPasswordPage) },
      { path: 'reset-password', element: page(ResetPasswordPage) },
      // The dynamic import sits inside the DEV branch so production builds drop the chunk entirely.
      ...(import.meta.env.DEV
        ? [
            { path: 'dev/design-system', element: page(lazy(() => import('../pages/dev/DesignSystemPage.jsx'))) },
            { path: 'dev/outbox', element: page(lazy(() => import('../pages/dev/OutboxPage.jsx'))) },
          ]
        : []),
      { path: '*', element: page(NotFoundPage) },
    ],
  },
  {
    path: 'app',
    errorElement: <RouteError />,
    element: (
      <RequireAuth>
        <InvestorLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <AppIndexRedirect /> },
      { path: 'dashboard', element: page(DashboardPage) },
      { path: 'documents', element: page(StatementsPage) },
      { path: 'notifications', element: page(NotificationsPage) },
      { path: 'referrals', element: page(ReferralsPage) },
      { path: 'support', element: page(SupportPage) },
      { path: 'support/:id', element: page(SupportTicketPage) },
      { path: 'verification', element: page(VerificationPage) },
      { path: 'wallet', element: page(WalletPage) },
      { path: 'deposit', element: page(DepositPage) },
      { path: 'deposits/:id', element: page(DepositStatusPage) },
      { path: 'withdraw', element: page(WithdrawPage) },
      { path: 'convert', element: page(ConvertPage) },
      { path: 'transactions', element: page(TransactionsPage) },
      { path: 'investments', element: page(MyInvestmentsPage) },
      { path: 'profile', element: page(ProfilePage) },
      { path: 'security', element: page(SecurityPage) },
    ],
  },
  {
    // Stand-in for a provider's hosted checkout page. Sandbox only, outside the app shells.
    path: 'sandbox/checkout/:reference',
    errorElement: <RouteError />,
    element: <RequireAuth>{page(SandboxCheckoutPage)}</RequireAuth>,
  },
  {
    path: 'admin',
    errorElement: <RouteError />,
    element: (
      <RequireAuth>
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <AdminIndexRedirect /> },
      { path: 'overview', element: withPermission('admin:dashboard', OverviewPage) },
      { path: 'insights', element: withPermission('reports:read', InsightsPage) },
      { path: 'fx', element: withPermission('fx:manage', FxPage) },
      { path: 'tax', element: withPermission('reports:read', TaxRulesPage) },
      { path: 'approvals', element: withPermission('admin:dashboard', ApprovalsPage) },
      { path: 'settings', element: withPermission('settings:read', SettingsPage) },
      { path: 'audit', element: withPermission('audit:read', AuditPage) },
      { path: 'reports', element: withPermission('reports:read', ReportsPage) },
      { path: 'messages', element: withPermission('notifications:manage', MessagesPage) },
      { path: 'compliance', element: withPermission('admin:dashboard', CompliancePage) },
      { path: 'compliance/cases/:id', element: withPermission('compliance:cases:read', ComplianceCasePage) },
      { path: 'kyc', element: withPermission('kyc:read:any', KycQueuePage) },
      { path: 'kyc/:id', element: withPermission('kyc:read:any', KycReviewPage) },
      { path: 'payments', element: withPermission('withdrawals:read:any', PaymentsPage) },
      { path: 'orders', element: withPermission('investments:orders:read:any', OrdersPage) },
      { path: 'ledger', element: withPermission('ledger:read', LedgerPage) },
      { path: 'support', element: withPermission('support:tickets:read:any', SupportDeskPage) },
      { path: 'support/:id', element: withPermission('support:tickets:read:any', SupportTicketAdminPage) },
      { path: 'referrals', element: withPermission('referrals:manage', ReferralsAdminPage) },
      { path: 'products', element: withPermission('products:read:any', ProductsPage) },
      { path: 'products/new', element: withPermission('products:manage', ProductEditorPage) },
      { path: 'products/:id', element: withPermission('products:read:any', ProductEditorPage) },
      { path: 'users', element: withPermission('users:read:any', UsersPage) },
      { path: 'users/:id', element: withPermission('users:read:any', UserDetailPage) },
      { path: 'roles', element: withPermission('roles:read', RolesPage) },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
