import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';
import { idempotency } from '../../middleware/idempotency.js';

const idParam = z.object({ id: z.uuid() });
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
const STATUSES = ['PENDING', 'CONFIRMED', 'ACTIVE', 'MATURED', 'CANCELLED', 'REJECTED', 'FAILED'];

/** Investor orders and portfolio, mounted at /api/v1/investments ahead of the public catalogue. */
export function ordersRoutes({ orders, prisma }) {
  const r = Router();
  const idem = idempotency({ prisma });
  r.post(
    '/orders',
    requirePermission('investments:order:own'),
    idem,
    validate({
      body: z
        .object({
          productSlug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
          amount: z.string().regex(/^\d{1,13}(\.\d{1,4})?$/, 'Enter an amount like 1000.00'),
          acceptRiskDisclosure: z.literal(true, { error: 'Confirm you have read the risk disclosure' }),
          acknowledgeUnsuitable: z.boolean().optional(),
        })
        .strict(),
    }),
    async (req, res) => res.status(201).json({ data: await orders.place(req.auth, req.body, requestContext(req)) }),
  );
  r.get('/orders', requirePermission('portfolio:read:own'), validate({ query: z.object(paging) }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json(await orders.listForUser(req.auth, req.validatedQuery)),
  );
  r.get('/orders/:id', requirePermission('portfolio:read:own'), validate({ params: idParam }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await orders.getForUser(req.auth, req.params.id) }),
  );
  r.post('/orders/:id/cancel', requirePermission('investments:order:own'), validate({ params: idParam }), async (req, res) =>
    res.json({ data: await orders.cancel(req.auth, req.params.id, requestContext(req)) }),
  );
  r.post(
    '/holdings/:id/rollover',
    requirePermission('investments:order:own'),
    validate({ params: idParam, body: z.object({ enabled: z.boolean(), acceptRiskDisclosure: z.boolean().optional() }).strict() }),
    async (req, res) => res.json({ data: await orders.setRollover(req.auth, req.params.id, req.body, requestContext(req)) }),
  );
  r.get('/portfolio', requirePermission('portfolio:read:own'), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await orders.portfolio(req.auth) }),
  );
  return r;
}

/** Staff order processing, mounted at /api/v1/admin. */
export function ordersAdminRoutes({ orders, prisma }) {
  const r = Router();
  const idem = idempotency({ prisma });
  const read = requirePermission('investments:orders:read:any');
  const manage = requirePermission('investments:orders:manage');
  const ctx = requestContext;

  r.get('/orders', read, validate({ query: z.object({ status: z.enum(STATUSES).optional(), ...paging }) }), async (req, res) =>
    res.json(await orders.listAll(req.validatedQuery)),
  );
  r.get('/orders/:id', read, validate({ params: idParam }), async (req, res) =>
    res.json({ data: await orders.getForStaff(req.params.id) }),
  );
  r.post(
    '/orders/:id/confirm',
    manage,
    idem,
    validate({
      params: idParam,
      body: z
        .object({
          custodianReference: z.string().trim().min(3, 'Enter the custodian or issuer allocation reference').max(120),
          notes: z.string().trim().max(1000).optional(),
        })
        .strict(),
    }),
    async (req, res) => res.json({ data: await orders.confirm(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  r.post(
    '/orders/:id/reject',
    manage,
    validate({ params: idParam, body: z.object({ note: z.string().trim().min(5).max(1000) }).strict() }),
    async (req, res) => res.json({ data: await orders.reject(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  r.get('/holdings/due', read, async (_req, res) => res.json({ data: await orders.listDueHoldings() }));
  r.post(
    '/holdings/:id/settle',
    manage,
    idem,
    validate({
      params: idParam,
      body: z
        .object({ proceeds: z.string().regex(/^\d{1,13}(\.\d{1,4})?$/), custodianReference: z.string().trim().min(3).max(120) })
        .strict(),
    }),
    async (req, res) => res.json({ data: await orders.settleMaturity(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  return r;
}
