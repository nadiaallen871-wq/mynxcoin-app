import express from 'express';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { requestId } from './middleware/request-id.js';
import { corsPolicy, rateLimiter, securityHeaders } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createCsrf } from './middleware/csrf.js';
import { authenticate } from './middleware/auth.js';
import { RedisRateLimitStore } from './middleware/rate-limit-store.js';
import { createContainer } from './container.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { createHealthService } from './modules/health/health.service.js';
import { platformRoutes } from './modules/platform/platform.routes.js';
import { createPlatformService } from './modules/platform/platform.service.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { createAuthController } from './modules/auth/auth.controller.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { accessRoutes } from './modules/admin/access.routes.js';
import { devRoutes } from './modules/dev/dev.routes.js';
import { onboardingRoutes } from './modules/onboarding/onboarding.routes.js';
import { documentsRoutes } from './modules/documents/documents.routes.js';
import { kycAdminRoutes, kycRoutes } from './modules/kyc/kyc.routes.js';
import { investmentsRoutes, productsAdminRoutes } from './modules/investments/investments.routes.js';
import { ledgerAdminRoutes, walletRoutes } from './modules/ledger/ledger.routes.js';
import { paymentsAdminRoutes, paymentsRoutes, walletMoneyRoutes } from './modules/payments/payments.routes.js';
import { ordersAdminRoutes, ordersRoutes } from './modules/investments/orders.routes.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { portfolioRoutes, statementsRoutes } from './modules/portfolio/portfolio.routes.js';
import { referralsAdminRoutes, referralsRoutes } from './modules/referrals/referrals.routes.js';
import { supportAdminRoutes, supportRoutes } from './modules/support/support.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { approvalsRoutes } from './modules/approvals/approvals.routes.js';
import { complianceRoutes } from './modules/compliance/compliance.routes.js';
import { maintenanceGuard } from './middleware/maintenance.js';
import { createMetrics } from './middleware/metrics.js';
import { fxAdminRoutes, fxRoutes } from './modules/fx/fx.routes.js';
import { insightsRoutes } from './modules/insights/insights.routes.js';

/**
 * Builds the Express application. Dependencies are injected so tests can
 * construct the app against real infrastructure with test configuration.
 *
 * Rate limits use Redis when `useRedisRateLimits` is true (the default outside
 * tests), so limits are shared across API instances.
 */
export function createApp({
  env,
  logger,
  prisma,
  redis,
  container = createContainer({ env, logger, prisma }),
  healthService,
  platformService,
  useRedisRateLimits = env.NODE_ENV !== 'test',
}) {
  const app = express();
  const isProduction = env.NODE_ENV === 'production';
  const store = (name) =>
    useRedisRateLimits && redis ? new RedisRateLimitStore({ client: redis, prefix: `${env.QUEUE_PREFIX}:rl:${name}:` }) : undefined;

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', 'simple');

  const metrics = createMetrics();
  app.use(requestId());
  app.use(metrics.middleware());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url.startsWith('/api/v1/health') },
    }),
  );
  app.use(securityHeaders({ isProduction }));
  app.use(corsPolicy({ origins: env.CORS_ORIGINS }));
  app.use(
    express.json({
      limit: '100kb',
      // Webhook signatures are computed over the exact bytes received, so keep the raw body for those routes.
      verify: (req, _res, buf) => {
        if (req.originalUrl.startsWith('/api/v1/payments/webhooks/')) req.rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(cookieParser());

  const csrf = createCsrf({ isProduction, exempt: [/^\/api\/v1\/payments\/webhooks\//] });
  const authLimiter = rateLimiter({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
    name: 'auth',
    store: store('auth'),
  });
  const verificationLimiter = rateLimiter({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
    name: 'verify',
    store: store('verify'),
  });

  // Expensive actions get a tighter per-user limit on top of the global per-IP limit.
  const heavyLimiter = rateLimiter({
    windowMs: 60_000,
    limit: env.HEAVY_RATE_LIMIT_MAX,
    name: 'heavy',
    store: store('heavy'),
    keyGenerator: (req) => `user:${req.auth?.user?.id ?? 'anonymous'}`,
  });
  const HEAVY = [
    ['POST', /^\/statements\/?$/],
    ['POST', /^\/support\/tickets(\/[^/]+\/messages)?\/?$/],
    ['POST', /^\/admin\/support\/tickets\/[^/]+\/messages\/?$/],
    ['POST', /^\/documents\/?$/],
    ['POST', /^\/fx\/quotes\/?$/],
    ['GET', /^\/admin\/audit\/export\/?$/],
    ['GET', /^\/admin\/reports\//],
  ];

  const api = express.Router();
  api.get('/health/metrics', metrics.handler(env.METRICS_TOKEN));
  api.use('/health', healthRoutes({ healthService: healthService ?? createHealthService({ redis, queuePrefix: env.QUEUE_PREFIX }) }));
  api.use(rateLimiter({ windowMs: env.RATE_LIMIT_WINDOW_MS, limit: env.RATE_LIMIT_MAX, store: store('global') }));
  api.use(csrf.protect());
  api.use(authenticate({ sessionService: container.sessions, usersRepository: container.users }));

  api.use(
    '/platform',
    platformRoutes({
      platformService: platformService ?? createPlatformService({ prisma, mode: env.PLATFORM_MODE, settings: container.settings }),
    }),
  );
  api.use(
    '/auth',
    authRoutes({
      controller: createAuthController({
        authService: container.auth,
        mfaService: container.mfa,
        sessionService: container.sessions,
        csrf,
      }),
      authLimiter,
    }),
  );
  api.use('/users', usersRoutes({ usersService: container.usersService, verificationLimiter }));
  api.use('/admin', accessRoutes({ accessService: container.access }));
  api.use('/onboarding', onboardingRoutes({ onboardingService: container.onboarding }));
  api.use('/documents', documentsRoutes({ documentsService: container.documents, maxBytes: env.UPLOAD_MAX_BYTES }));
  api.use('/kyc', kycRoutes({ kycService: container.kyc }));
  api.use('/admin/kyc', kycAdminRoutes({ kycService: container.kyc, documentsService: container.documents }));
  // Order and portfolio routes are mounted before the public catalogue so /investments/orders is not read as a product slug.
  api.use((req, res, next) =>
    HEAVY.some(([method, path]) => req.method === method && path.test(req.path)) ? heavyLimiter(req, res, next) : next(),
  );
  // Maintenance mode pauses investor money movements (system setting, changed with a second approver).
  api.post(
    ['/wallet/deposits', '/wallet/withdrawals', '/investments/orders', '/fx/conversions'],
    maintenanceGuard({ settings: container.settings }),
  );
  api.use('/investments', ordersRoutes({ orders: container.orders, prisma }));
  api.use('/investments', investmentsRoutes({ productsService: container.products }));
  api.use('/admin/products', productsAdminRoutes({ productsService: container.products, maxBytes: env.UPLOAD_MAX_BYTES }));
  api.use('/wallet', walletRoutes({ walletService: container.walletService }));
  api.use('/wallet', walletMoneyRoutes({ deposits: container.deposits, withdrawals: container.withdrawals, prisma }));
  api.use('/payments', paymentsRoutes({ deposits: container.deposits }));
  api.use('/admin/payments', paymentsAdminRoutes({ deposits: container.deposits, withdrawals: container.withdrawals, prisma }));
  api.use('/admin', ordersAdminRoutes({ orders: container.orders, prisma }));
  api.use('/admin', ledgerAdminRoutes({ ...container, prisma }));
  api.use('/notifications', notificationsRoutes({ notifications: container.notifications }));
  api.use('/portfolio', portfolioRoutes({ portfolio: container.portfolio }));
  api.use('/statements', statementsRoutes({ statements: container.statements }));
  api.use('/referrals', referralsRoutes({ referrals: container.referrals }));
  api.use('/admin/referrals', referralsAdminRoutes({ referrals: container.referrals }));
  api.use('/support', supportRoutes({ support: container.support, maxBytes: env.UPLOAD_MAX_BYTES }));
  api.use('/admin/support', supportAdminRoutes({ support: container.support, maxBytes: env.UPLOAD_MAX_BYTES }));
  api.use('/admin', adminRoutes({ overview: container.overview, records: container.records }));
  api.use('/admin', approvalsRoutes({ approvals: container.approvals, settingsAdmin: container.settingsAdmin }));
  api.use('/admin/compliance', complianceRoutes({ compliance: container.compliance }));
  api.use('/fx', fxRoutes({ fx: container.fx }));
  api.use('/admin/fx', fxAdminRoutes({ fx: container.fx }));
  api.use('/admin', insightsRoutes({ insights: container.insights, tax: container.tax }));
  if (env.NODE_ENV === 'development') api.use('/dev', devRoutes({ prisma }));

  app.use('/api/v1', api);
  app.use(notFoundHandler());
  app.use(errorHandler({ logger }));

  return app;
}
