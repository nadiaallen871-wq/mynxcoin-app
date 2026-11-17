import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requireAuth, requirePermission } from '../../middleware/auth.js';
import { idempotency } from '../../middleware/idempotency.js';

const amount = z.string().regex(/^\d{1,13}(\.\d{1,4})?$/, 'Enter an amount like 250.00');
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .default('GHS');
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
const idParam = z.object({ id: z.uuid() });

const destinationSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('MOBILE_MONEY'),
    destination: z.object({
      network: z.enum(['MTN', 'TELECEL', 'AIRTELTIGO']),
      accountNumber: z.string().regex(/^0\d{9}$/, 'Enter a 10-digit mobile number starting with 0'),
      accountName: z.string().trim().min(3).max(120),
    }),
  }),
  z.object({
    method: z.literal('BANK_ACCOUNT'),
    destination: z.object({
      bankCode: z
        .string()
        .trim()
        .regex(/^[A-Z0-9]{2,12}$/, 'Choose a bank'),
      accountNumber: z.string().regex(/^\d{8,20}$/, 'Enter the account number (digits only)'),
      accountName: z.string().trim().min(3).max(120),
    }),
  }),
]);

/** Investor deposits and withdrawals, mounted at /api/v1/wallet. */
export function walletMoneyRoutes({ deposits, withdrawals, prisma }) {
  const r = Router();
  const idem = idempotency({ prisma });
  const ctx = requestContext;

  r.post(
    '/deposits',
    requirePermission('deposits:create:own'),
    idem,
    validate({ body: z.object({ amount, currency }).strict() }),
    async (req, res) => {
      res.status(201).json({ data: await deposits.initiate(req.auth, req.body, ctx(req)) });
    },
  );
  r.get('/deposits', requirePermission('wallet:read:own'), validate({ query: z.object(paging) }), async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await deposits.listForUser(req.auth.user.id, req.validatedQuery));
  });
  r.get(
    '/deposits/:id',
    requirePermission('wallet:read:own'),
    validate({ params: idParam, query: z.object({ refresh: z.enum(['0', '1']).optional() }) }),
    async (req, res) => {
      res
        .set('Cache-Control', 'no-store')
        .json({ data: await deposits.get(req.auth, req.params.id, { refresh: req.validatedQuery.refresh === '1' }) });
    },
  );

  r.post(
    '/withdrawals',
    requirePermission('withdrawals:create:own'),
    idem,
    validate({ body: z.intersection(z.object({ amount, currency }), destinationSchema) }),
    async (req, res) => res.status(201).json({ data: await withdrawals.request(req.auth, req.body, ctx(req)) }),
  );
  r.get('/withdrawals', requirePermission('wallet:read:own'), validate({ query: z.object(paging) }), async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await withdrawals.listForUser(req.auth.user.id, req.validatedQuery));
  });
  r.post('/withdrawals/:id/cancel', requirePermission('withdrawals:create:own'), validate({ params: idParam }), async (req, res) => {
    res.json({ data: await withdrawals.cancel(req.auth, req.params.id, ctx(req)) });
  });

  return r;
}

/** Provider webhooks and the sandbox checkout, mounted at /api/v1/payments. */
export function paymentsRoutes({ deposits }) {
  const r = Router();

  // Unauthenticated by design: authenticity comes from the provider signature over the raw body.
  // CSRF-exempt (see app.js). Always acknowledges once the event is safely stored.
  r.post('/webhooks/:provider', validate({ params: z.object({ provider: z.enum(['sandbox', 'paystack']) }) }), async (req, res) => {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
    const result = await deposits.handleWebhook(req.params.provider, { rawBody: req.rawBody, headers });
    res.json({ received: true, duplicate: result.duplicate });
  });

  r.get(
    '/sandbox/:reference',
    requireAuth(),
    validate({ params: z.object({ reference: z.string().regex(/^dep_[A-Za-z0-9]{8,40}$/) }) }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store').json({ data: await deposits.sandboxCheckoutInfo(req.auth, req.params.reference) });
    },
  );
  r.post(
    '/sandbox/:reference/complete',
    requireAuth(),
    validate({
      params: z.object({ reference: z.string().regex(/^dep_[A-Za-z0-9]{8,40}$/) }),
      body: z.object({ outcome: z.enum(['success', 'failure']) }),
    }),
    async (req, res) => res.json({ data: await deposits.simulateSandboxCheckout(req.auth, req.params.reference, req.body.outcome) }),
  );

  return r;
}

/** Staff payment operations, mounted at /api/v1/admin/payments. */
export function paymentsAdminRoutes({ deposits, withdrawals, prisma }) {
  const r = Router();
  const idem = idempotency({ prisma });
  const ctx = requestContext;

  r.get(
    '/deposits',
    requirePermission('deposits:read:any'),
    validate({
      query: z.object({ status: z.enum(['INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REVERSED']).optional(), ...paging }),
    }),
    async (req, res) => res.json(await deposits.listAll(req.validatedQuery)),
  );
  r.get(
    '/withdrawals',
    requirePermission('withdrawals:read:any'),
    validate({
      query: z.object({
        status: z.enum(['REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED', 'RETURNED']).optional(),
        ...paging,
      }),
    }),
    async (req, res) => res.json(await withdrawals.listAll(req.validatedQuery)),
  );
  r.get('/withdrawals/:id', requirePermission('withdrawals:read:any'), validate({ params: idParam }), async (req, res) =>
    res.json({ data: await withdrawals.getForStaff(req.params.id) }),
  );
  r.post(
    '/withdrawals/:id/approve',
    requirePermission('withdrawals:approve'),
    idem,
    validate({ params: idParam, body: z.object({ note: z.string().trim().max(1000).optional() }) }),
    async (req, res) => res.json({ data: await withdrawals.approve(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  r.post(
    '/withdrawals/:id/reject',
    requirePermission('withdrawals:approve'),
    validate({ params: idParam, body: z.object({ note: z.string().trim().min(5).max(1000) }) }),
    async (req, res) => res.json({ data: await withdrawals.reject(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  r.post('/withdrawals/:id/retry', requirePermission('withdrawals:approve'), idem, validate({ params: idParam }), async (req, res) =>
    res.json({ data: await withdrawals.retry(req.auth, req.params.id, ctx(req)) }),
  );
  r.post(
    '/withdrawals/:id/return',
    requirePermission('withdrawals:approve'),
    validate({ params: idParam, body: z.object({ note: z.string().trim().max(500).optional() }) }),
    async (req, res) => res.json({ data: await withdrawals.returnToWallet(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  return r;
}
