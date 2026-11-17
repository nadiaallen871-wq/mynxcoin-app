import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';

const currency = z.string().regex(/^[A-Z]{3}$/);
const amount = z.string().regex(/^\d{1,13}(\.\d{1,4})?$/, 'Enter an amount like 250.00');
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };

/** Investor currency conversion, mounted at /api/v1/fx. */
export function fxRoutes({ fx }) {
  const r = Router();
  const own = requirePermission('fx:convert:own');
  r.get('/rates', own, async (_req, res) => res.set('Cache-Control', 'no-store').json({ data: await fx.rates() }));
  r.post('/quotes', own, validate({ body: z.object({ from: currency, to: currency, amount }).strict() }), async (req, res) =>
    res.status(201).json({ data: await fx.quote(req.auth, req.body) }),
  );
  // A quote can be used once, so repeating this request cannot convert twice.
  r.post('/conversions', own, validate({ body: z.object({ quoteId: z.uuid() }).strict() }), async (req, res) =>
    res.status(201).json({ data: await fx.convert(req.auth, req.body.quoteId, requestContext(req)) }),
  );
  r.get('/conversions', own, validate({ query: z.object(paging) }), async (req, res) =>
    res.json(await fx.listConversions(req.auth.user.id, req.validatedQuery)),
  );
  return r;
}

/** FX administration, mounted at /api/v1/admin/fx. */
export function fxAdminRoutes({ fx }) {
  const r = Router();
  const manage = requirePermission('fx:manage');
  r.get('/rates', manage, async (_req, res) => res.json({ data: await fx.rates() }));
  r.post('/rates/refresh', manage, async (_req, res) => res.json({ data: await fx.refreshRates() }));
  r.get('/positions', manage, async (_req, res) => res.json({ data: await fx.positions() }));
  r.get('/conversions', manage, validate({ query: z.object(paging) }), async (req, res) =>
    res.json(await fx.listConversions(null, req.validatedQuery)),
  );
  r.post(
    '/currencies/:code/proposals',
    manage,
    validate({
      params: z.object({ code: currency }),
      body: z.object({ active: z.boolean(), reason: z.string().trim().min(10).max(1000) }).strict(),
    }),
    async (req, res) =>
      res.status(202).json({ data: await fx.proposeCurrencyStatus(req.auth, req.params.code, req.body, requestContext(req)) }),
  );
  return r;
}
