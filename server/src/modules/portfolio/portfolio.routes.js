import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';

const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .default('GHS');
const day = z.iso.date().transform((s) => new Date(`${s}T00:00:00Z`));

/** Dashboard, holdings and analytics, mounted at /api/v1/portfolio. */
export function portfolioRoutes({ portfolio }) {
  const r = Router();
  const read = requirePermission('portfolio:read:own');

  r.get('/dashboard', read, validate({ query: z.object({ currency }) }), async (req, res) =>
    res
      .set('Cache-Control', 'no-store')
      .json({ data: await portfolio.dashboard(req.auth.user.id, { currency: req.validatedQuery.currency }) }),
  );
  r.get('/holdings', read, validate({ query: z.object({ currency }) }), async (req, res) =>
    res
      .set('Cache-Control', 'no-store')
      .json({ data: await portfolio.holdings(req.auth.user.id, { currency: req.validatedQuery.currency }) }),
  );
  r.get('/history', read, validate({ query: z.object({ currency, from: day.optional(), to: day.optional() }) }), async (req, res) => {
    const { currency: c, from, to } = req.validatedQuery;
    res
      .set('Cache-Control', 'no-store')
      .json({ data: await portfolio.history(req.auth.user.id, { currency: c, from, to: to ?? new Date() }) });
  });
  r.get(
    '/analytics',
    read,
    validate({
      query: z
        .object({ currency, from: day, to: day })
        .refine((q) => q.to >= q.from, { path: ['to'], message: 'The end date must be after the start date' })
        .refine((q) => q.to - q.from <= 366 * 86_400_000, { path: ['to'], message: 'Choose a period of one year or less' }),
    }),
    async (req, res) => {
      const { currency: c, from, to } = req.validatedQuery;
      res
        .set('Cache-Control', 'no-store')
        .json({ data: await portfolio.analytics(req.auth.user.id, { currency: c, from, to: new Date(to.getTime() + 86_400_000) }) });
    },
  );
  return r;
}

/** Generated statements, reports, confirmations and receipts, mounted at /api/v1/statements. */
export function statementsRoutes({ statements }) {
  const r = Router();
  const read = requirePermission('documents:read:own');

  r.get(
    '/',
    read,
    validate({
      query: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }),
    }),
    async (req, res) => res.set('Cache-Control', 'no-store').json(await statements.list(req.auth.user.id, req.validatedQuery)),
  );
  r.post(
    '/',
    read,
    validate({
      body: z
        .object({
          kind: z.enum([
            'ACCOUNT_STATEMENT',
            'PORTFOLIO_STATEMENT',
            'TRANSACTION_REPORT',
            'INVESTMENT_CONFIRMATION',
            'DEPOSIT_RECEIPT',
            'WITHDRAWAL_RECEIPT',
            'TAX_STATEMENT',
          ]),
          format: z.enum(['PDF', 'CSV']).default('PDF'),
          currency,
          from: day.optional(),
          to: day.optional(),
          asOf: day.optional(),
          referenceId: z.uuid().optional(),
          year: z.number().int().optional(),
        })
        .strict(),
    }),
    async (req, res) => res.status(201).json({ data: await statements.generate(req.auth, req.body, requestContext(req)) }),
  );
  r.get('/:id/download-url', read, validate({ params: z.object({ id: z.uuid() }) }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await statements.issueDownloadUrl(req.auth, req.params.id, requestContext(req)) }),
  );
  r.get('/download', read, validate({ query: z.object({ token: z.string().min(20).max(600) }) }), async (req, res) => {
    const { buffer, mimeType, filename } = await statements.download(req.auth, req.validatedQuery.token, requestContext(req));
    res
      .set({
        'Content-Type': mimeType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store, private',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      })
      .send(buffer);
  });
  return r;
}
