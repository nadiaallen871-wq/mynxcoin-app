import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';
import { idempotency } from '../../middleware/idempotency.js';

const currency = z.string().regex(/^[A-Z]{3}$/);
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const idParam = z.object({ id: z.uuid() });

/** /api/v1/wallet: the signed-in investor's own wallet (read-only in this phase). */
export function walletRoutes({ walletService }) {
  const r = Router();
  r.get('/', requirePermission('wallet:read:own'), async (req, res) => {
    const [wallets, activity] = await Promise.all([
      walletService.summary(req.auth.user.id),
      walletService.activity(req.auth.user.id, { pageSize: 10 }),
    ]);
    res.set('Cache-Control', 'no-store').json({ data: { wallets, recentActivity: activity.data } });
  });
  r.get(
    '/activity',
    requirePermission('wallet:read:own'),
    validate({ query: z.object({ currency: currency.optional(), ...paging }) }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store').json(await walletService.activity(req.auth.user.id, req.validatedQuery));
    },
  );
  return r;
}

/** /api/v1/admin/ledger and /api/v1/admin/wallets: finance and compliance tools. */
export function ledgerAdminRoutes({ ledger, adjustments, reconciliation, walletService, prisma }) {
  const r = Router();
  const read = requirePermission('ledger:read');
  const ctx = requestContext;
  const idem = idempotency({ prisma });

  r.get('/ledger/accounts', read, validate({ query: z.object({ currency: currency.default('GHS') }) }), async (req, res) => {
    res.json({ data: await ledger.listAccounts({ currency: req.validatedQuery.currency }) });
  });
  r.get('/ledger/trial-balance', read, validate({ query: z.object({ currency: currency.default('GHS') }) }), async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ data: await ledger.trialBalance(req.validatedQuery.currency) });
  });
  r.get('/ledger/entries', read, validate({ query: z.object({ type: z.string().max(40).optional(), ...paging }) }), async (req, res) => {
    res.json(await ledger.listEntries(req.validatedQuery));
  });
  r.get('/ledger/entries/:id', read, validate({ params: idParam }), async (req, res) =>
    res.json({ data: await ledger.getEntry(req.params.id) }),
  );

  r.get(
    '/ledger/adjustments',
    read,
    validate({ query: z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(), ...paging }) }),
    async (req, res) => {
      res.json(await adjustments.list(req.validatedQuery));
    },
  );
  r.post(
    '/ledger/adjustments',
    requirePermission('ledger:adjustment:initiate'),
    idem,
    validate({
      body: z
        .object({
          customerEmail: z.string().trim().email(),
          currency,
          direction: z.enum(['CREDIT', 'DEBIT']),
          amount: z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Enter an amount like 500.00'),
          reason: z.string().trim().min(15, 'Explain the reason in at least 15 characters').max(1000),
        })
        .strict(),
    }),
    async (req, res) => res.status(201).json({ data: await adjustments.request(req.auth, req.body, ctx(req)) }),
  );
  r.post(
    '/ledger/adjustments/:id/approve',
    requirePermission('ledger:adjustment:approve'),
    idem,
    validate({ params: idParam, body: z.object({ note: z.string().trim().max(1000).optional() }).strict() }),
    async (req, res) => res.json({ data: await adjustments.approve(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  r.post(
    '/ledger/adjustments/:id/reject',
    requirePermission('ledger:adjustment:approve'),
    validate({ params: idParam, body: z.object({ note: z.string().trim().min(5).max(1000) }).strict() }),
    async (req, res) => res.json({ data: await adjustments.reject(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  r.post(
    '/ledger/adjustments/:id/cancel',
    requirePermission('ledger:adjustment:initiate'),
    validate({ params: idParam }),
    async (req, res) => {
      res.json({ data: await adjustments.cancel(req.auth, req.params.id, ctx(req)) });
    },
  );

  r.get('/ledger/reconciliations', read, validate({ query: z.object(paging) }), async (req, res) =>
    res.json(await reconciliation.list(req.validatedQuery)),
  );
  r.post('/ledger/reconciliations', requirePermission('reconciliation:run'), async (req, res) => {
    res.status(201).json({ data: await reconciliation.runLedgerIntegrity({ triggeredById: req.auth.user.id }) });
  });

  r.get(
    '/wallets/:userId',
    requirePermission('wallet:read:any'),
    validate({ params: z.object({ userId: z.uuid() }), query: z.object(paging) }),
    async (req, res) => {
      const [wallets, activity] = await Promise.all([
        walletService.summary(req.params.userId),
        walletService.activity(req.params.userId, req.validatedQuery),
      ]);
      res.set('Cache-Control', 'no-store').json({ data: { wallets, activity } });
    },
  );
  r.post(
    '/wallets/:userId/status',
    requirePermission('compliance:cases:manage'),
    validate({
      params: z.object({ userId: z.uuid() }),
      body: z
        .object({ currency, frozen: z.boolean(), reason: z.string().trim().min(10).max(500).optional() })
        .refine((v) => !v.frozen || v.reason, { path: ['reason'], message: 'Give a reason for freezing' }),
    }),
    async (req, res) =>
      res.json({ data: await walletService.setStatus(req.auth, req.params.userId, req.body.currency, req.body, ctx(req)) }),
  );

  return r;
}
