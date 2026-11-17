import { createSandboxProvider } from './integrations/messaging/sandbox.provider.js';
import { createAuditService } from './modules/audit/audit.service.js';
import { createMessagingService } from './modules/notifications/messaging.service.js';
import { createSessionService } from './modules/auth/session.service.js';
import { createTokenService } from './modules/auth/tokens.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createMfaService } from './modules/auth/mfa.service.js';
import { createUsersRepository } from './modules/users/users.repository.js';
import { createUsersService } from './modules/users/users.service.js';
import { createAccessService } from './modules/admin/access.service.js';
import { resolve } from 'node:path';
import { createLocalStorage } from './integrations/storage/local.storage.js';
import { createSandboxScreening } from './integrations/screening/sandbox.screening.js';
import { createBasicScanner } from './modules/documents/file-validation.js';
import { createUrlSigner } from './modules/documents/signed-url.js';
import { createDocumentsService } from './modules/documents/documents.service.js';
import { createOnboardingService } from './modules/onboarding/onboarding.service.js';
import { createKycService } from './modules/kyc/kyc.service.js';
import { createProductsService } from './modules/investments/products.service.js';
import { createLedgerService } from './modules/ledger/ledger.service.js';
import { createWalletService } from './modules/wallet/wallet.service.js';
import { createAdjustmentsService } from './modules/ledger/adjustments.service.js';
import { createReconciliationService } from './modules/ledger/reconciliation.service.js';
import { createSandboxPaymentProvider } from './integrations/payments/sandbox.provider.js';
import { createPaystackProvider } from './integrations/payments/paystack.provider.js';
import { createDepositsService } from './modules/payments/deposits.service.js';
import { createWithdrawalsService } from './modules/payments/withdrawals.service.js';
import { createOrdersService } from './modules/investments/orders.service.js';
import { createNotificationsService } from './modules/notifications/notifications.service.js';
import { createPortfolioService } from './modules/portfolio/portfolio.service.js';
import { createStatementsService } from './modules/statements/statements.service.js';
import { createReferralsService } from './modules/referrals/referrals.service.js';
import { createSupportService } from './modules/support/support.service.js';
import { createSettingsService } from './modules/settings/settings.service.js';
import { createSettingsAdmin } from './modules/settings/settings.admin.js';
import { createApprovalsService } from './modules/approvals/approvals.service.js';
import { createMonitoringService } from './modules/compliance/monitoring.service.js';
import { createComplianceService } from './modules/compliance/compliance.service.js';
import { createOverviewService } from './modules/admin/overview.service.js';
import { createRecordsService } from './modules/admin/records.service.js';
import { createSandboxFxProvider } from './integrations/fx/sandbox.fx.js';
import { createFxService } from './modules/fx/fx.service.js';
import { createTaxService } from './modules/tax/tax.service.js';
import { createInsightsService } from './modules/insights/insights.service.js';
import { hmacSha256 } from './utils/crypto.js';

// Relative storage paths resolve against the server package, whatever the working directory.
const serverRoot = resolve(import.meta.dirname, '..');

/**
 * Composition root: builds every service once, with its dependencies wired.
 * Both the API and the worker use it. Tests build their own with real infra.
 * `notificationsQueue` is optional. Without it, messages are delivered inline.
 */
export function createContainer({ env, logger, prisma, notificationsQueue = null }) {
  const audit = createAuditService({ prisma });
  // Environment values are the deployment defaults; approved changes stored in the database win.
  const settings = createSettingsService({
    prisma,
    defaults: {
      'payments.deposit_min_minor': env.DEPOSIT_MIN_MINOR,
      'payments.deposit_max_minor': env.DEPOSIT_MAX_MINOR,
      'payments.withdrawal_min_minor': env.WITHDRAWAL_MIN_MINOR,
      'payments.withdrawal_fee_minor': env.WITHDRAWAL_FEE_MINOR,
      'payments.large_withdrawal_minor': env.LARGE_WITHDRAWAL_MINOR,
    },
  });
  const approvals = createApprovalsService({ prisma, audit });
  const providers = { EMAIL: createSandboxProvider({ logger }), SMS: createSandboxProvider({ logger }) };
  const messaging = createMessagingService({ prisma, env, logger, providers, queue: notificationsQueue });
  const sessions = createSessionService({ prisma, env });
  const tokens = createTokenService({ prisma, env });
  const users = createUsersRepository({ prisma });
  const mfa = createMfaService({ prisma, env, sessions, messaging, audit });
  // Late-bound: the referrals service is built further down, after the ledger it pays from.
  let referrals = null;
  const auth = createAuthService({
    prisma,
    env,
    sessions,
    tokens,
    messaging,
    audit,
    users,
    onRegistered: (tx, args) => referrals.attachAtRegistration(tx, args),
    // Late-bound: monitoring is built just below.
    onLoginSucceeded: (args) => monitoring.onLogin(args),
  });
  const usersService = createUsersService({ prisma, tokens, messaging, audit, users, mfa, sessions });
  const access = createAccessService({ prisma, tokens, messaging, audit, users, sessions, approvals });
  const monitoring = createMonitoringService({ prisma, settings, logger });

  const storage = createLocalStorage({ baseDir: resolve(serverRoot, env.STORAGE_LOCAL_DIR), encryptionKey: env.ENCRYPTION_KEY });
  const signer = createUrlSigner({ secret: env.SESSION_SECRET, ttlSeconds: env.DOCUMENT_URL_TTL_SECONDS });
  const onboarding = createOnboardingService({ prisma, env, audit });
  const documents = createDocumentsService({ prisma, storage, scanner: createBasicScanner(), signer, audit });
  const kyc = createKycService({ prisma, audit, messaging, screening: createSandboxScreening(), onboarding });
  const products = createProductsService({ prisma, storage, audit });
  const ledger = createLedgerService({ prisma });
  const walletService = createWalletService({ prisma, ledger, audit });
  const adjustments = createAdjustmentsService({ prisma, ledger, wallets: walletService, audit });
  const reconciliation = createReconciliationService({ prisma, logger });
  // Payment provider: sandbox by default. The env validation refuses live keys in sandbox mode.
  const paymentProvider =
    env.PAYMENT_PROVIDER === 'paystack'
      ? createPaystackProvider({ secretKey: env.PAYSTACK_SECRET_KEY })
      : createSandboxPaymentProvider({
          prisma,
          appBaseUrl: env.APP_BASE_URL,
          webhookSecret: env.SANDBOX_WEBHOOK_SECRET ?? hmacSha256(env.SESSION_SECRET, 'sandbox-webhook-secret'),
        });
  const deposits = createDepositsService({
    prisma,
    env,
    ledger,
    wallets: walletService,
    provider: paymentProvider,
    messaging,
    audit,
    logger,
    settings,
    monitoring,
  });
  const withdrawals = createWithdrawalsService({
    prisma,
    env,
    ledger,
    wallets: walletService,
    provider: paymentProvider,
    messaging,
    audit,
    logger,
    settings,
    monitoring,
  });
  const orders = createOrdersService({
    prisma,
    ledger,
    wallets: walletService,
    messaging,
    audit,
    onInvestmentConfirmed: (userId) => referrals.evaluate(userId),
  });
  referrals = createReferralsService({ prisma, env, ledger, wallets: walletService, messaging, audit, logger, monitoring });
  const notifications = createNotificationsService({ prisma });
  const portfolio = createPortfolioService({ prisma, settings });
  const tax = createTaxService({ prisma, approvals });
  // A separate signing key, so a statement link can never be replayed against the KYC download endpoint.
  const statementSigner = createUrlSigner({
    secret: hmacSha256(env.SESSION_SECRET, 'generated-documents'),
    ttlSeconds: env.DOCUMENT_URL_TTL_SECONDS,
  });
  const statements = createStatementsService({
    prisma,
    storage,
    signer: statementSigner,
    tax,
    portfolio,
    audit,
    sandbox: env.PLATFORM_MODE !== 'live',
  });
  const support = createSupportService({ prisma, storage, scanner: createBasicScanner(), messaging, audit });
  const settingsAdmin = createSettingsAdmin({ prisma, settings, approvals });
  const compliance = createComplianceService({ prisma, audit, wallets: walletService });
  const overview = createOverviewService({ prisma, approvals });
  const records = createRecordsService({ prisma, audit, messaging });
  // Only the sandbox rate provider exists; a live adapter (central bank or licensed FX provider) is a go-live prerequisite.
  const fx = createFxService({ prisma, ledger, wallets: walletService, provider: createSandboxFxProvider(), settings, audit, approvals });
  fx.registerApprovals();
  const insights = createInsightsService({ prisma, settings });

  return {
    audit,
    messaging,
    sessions,
    tokens,
    users,
    mfa,
    auth,
    usersService,
    access,
    storage,
    signer,
    onboarding,
    documents,
    kyc,
    products,
    ledger,
    walletService,
    adjustments,
    reconciliation,
    paymentProvider,
    deposits,
    withdrawals,
    orders,
    referrals,
    notifications,
    portfolio,
    statements,
    support,
    settings,
    settingsAdmin,
    approvals,
    monitoring,
    compliance,
    overview,
    records,
    fx,
    tax,
    insights,
  };
}
