import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';

const day = z.iso.date().transform((s) => new Date(`${s}T00:00:00Z`));
const nextDay = (d) => new Date(d.getTime() + 86_400_000);
const paging = (max = 100, dflt = 50) => ({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(max).default(dflt),
});
const range = (q) => q.to >= q.from && q.to - q.from <= 366 * 86_400_000;

const auditQuery = z.object({
  actor: z.string().trim().max(320).optional(),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  from: day.optional(),
  to: day.optional(),
  ...paging(200, 50),
});

const sendCsv = (res, name, csv) =>
  res
    .set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store, private',
    })
    .send(csv);

/** Overview, audit viewer, reports and message log, mounted at /api/v1/admin. */
export function adminRoutes({ overview, records }) {
  const r = Router();

  r.get('/overview', requirePermission('admin:dashboard'), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await overview.overview(req.auth) }),
  );

  r.get('/audit', requirePermission('audit:read'), validate({ query: auditQuery }), async (req, res) => {
    const q = req.validatedQuery;
    res.json(await records.listAudit({ ...q, to: q.to ? nextDay(q.to) : undefined }));
  });
  r.get('/audit/export', requirePermission('audit:read'), validate({ query: auditQuery }), async (req, res) => {
    const q = req.validatedQuery;
    sendCsv(
      res,
      'audit-log.csv',
      await records.exportAudit(
        req.auth,
        { ...q, to: q.to ? nextDay(q.to) : undefined, page: undefined, pageSize: undefined },
        requestContext(req),
      ),
    );
  });
  r.get(
    '/audit/:id',
    requirePermission('audit:read'),
    validate({ params: z.object({ id: z.string().regex(/^\d{1,18}$/) }) }),
    async (req, res) => res.json({ data: await records.getAudit(req.params.id) }),
  );

  r.get(
    '/reports/:kind',
    requirePermission('reports:read'),
    validate({
      params: z.object({ kind: z.enum(records.REPORT_KINDS) }),
      query: z
        .object({ from: day, to: day, currency: z.enum(['GHS', 'USD']).default('GHS'), format: z.enum(['json', 'csv']).default('json') })
        .refine(range, { path: ['to'], message: 'Choose a period of up to one year, ending after it starts' }),
    }),
    async (req, res) => {
      const q = req.validatedQuery;
      const result = await records.report(req.auth, req.params.kind, { ...q, to: nextDay(q.to) }, requestContext(req));
      if (q.format === 'csv') return sendCsv(res, `${req.params.kind}-${q.from.toISOString().slice(0, 10)}.csv`, result);
      return res.json({ data: result });
    },
  );

  r.get(
    '/messages',
    requirePermission('notifications:manage'),
    validate({
      query: z.object({
        status: z.enum(['QUEUED', 'SENT', 'FAILED']).optional(),
        channel: z.enum(['EMAIL', 'SMS']).optional(),
        template: z.string().max(64).optional(),
        ...paging(100, 50),
      }),
    }),
    async (req, res) => res.json(await records.listMessages(req.validatedQuery)),
  );
  r.get('/messages/templates', requirePermission('notifications:manage'), (_req, res) => res.json({ data: records.templates() }));
  r.post(
    '/messages/:id/retry',
    requirePermission('notifications:manage'),
    validate({ params: z.object({ id: z.uuid() }) }),
    async (req, res) => res.json({ data: await records.retryMessage(req.auth, req.params.id, requestContext(req)) }),
  );
  return r;
}
