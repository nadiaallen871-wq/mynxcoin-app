import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';

const idParam = z.object({ id: z.uuid() });
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const note = z.string().trim().min(5, 'Add a note (at least 5 characters)').max(4000);
const CASE_TYPES = ['AML', 'SANCTIONS', 'PEP', 'FRAUD', 'KYC', 'OTHER'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
const STATUSES = ['OPEN', 'INVESTIGATING', 'ESCALATED', 'CLOSED_NO_ACTION', 'CLOSED_ACTION_TAKEN'];

/** Monitoring alerts and compliance cases, mounted at /api/v1/admin/compliance. */
export function complianceRoutes({ compliance }) {
  const r = Router();
  const alertsRead = requirePermission('fraud:alerts:read');
  const alertsManage = requirePermission('fraud:alerts:manage', 'compliance:cases:manage');
  const casesRead = requirePermission('compliance:cases:read');
  const casesManage = requirePermission('compliance:cases:manage');
  const ctx = requestContext;

  r.get(
    '/alerts',
    alertsRead,
    validate({
      query: z.object({
        status: z.enum(['OPEN', 'DISMISSED', 'ESCALATED']).optional(),
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
        rule: z.string().max(40).optional(),
        userId: z.uuid().optional(),
        ...paging,
      }),
    }),
    async (req, res) => res.json(await compliance.listAlerts(req.validatedQuery)),
  );
  r.post('/alerts/:id/dismiss', alertsManage, validate({ params: idParam, body: z.object({ note }).strict() }), async (req, res) =>
    res.json({ data: await compliance.dismissAlert(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  r.post(
    '/alerts/:id/escalate',
    alertsManage,
    validate({
      params: idParam,
      body: z
        .object({ note, caseId: z.uuid().optional(), type: z.enum(CASE_TYPES).optional(), priority: z.enum(PRIORITIES).optional() })
        .strict(),
    }),
    async (req, res) => res.status(201).json({ data: await compliance.escalateAlert(req.auth, req.params.id, req.body, ctx(req)) }),
  );

  r.get(
    '/cases',
    casesRead,
    validate({
      query: z.object({
        status: z.enum([...STATUSES, 'OPEN_ANY', 'ALL']).optional(),
        type: z.enum(CASE_TYPES).optional(),
        assignee: z.enum(['me', 'unassigned']).optional(),
        ...paging,
      }),
    }),
    async (req, res) => res.json(await compliance.listCases({ ...req.validatedQuery, staffId: req.auth.user.id })),
  );
  r.post(
    '/cases',
    casesManage,
    validate({
      body: z
        .object({
          subjectUserId: z.uuid(),
          type: z.enum(CASE_TYPES),
          priority: z.enum(PRIORITIES).default('NORMAL'),
          title: z.string().trim().min(5).max(200),
          note,
        })
        .strict(),
    }),
    async (req, res) => res.status(201).json({ data: await compliance.openCase(req.auth, req.body, ctx(req)) }),
  );
  r.get('/officers', casesRead, async (_req, res) => res.json({ data: await compliance.officers() }));
  r.get('/cases/:id', casesRead, validate({ params: idParam }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await compliance.getCase(req.params.id) }),
  );
  r.post('/cases/:id/notes', casesManage, validate({ params: idParam, body: z.object({ body: note }).strict() }), async (req, res) =>
    res.status(201).json({ data: await compliance.addNote(req.auth, req.params.id, req.body) }),
  );
  r.patch(
    '/cases/:id',
    casesManage,
    validate({
      params: idParam,
      body: z
        .object({
          status: z.enum(STATUSES).optional(),
          priority: z.enum(PRIORITIES).optional(),
          assigneeId: z.uuid().nullable().optional(),
          outcome: z.string().trim().max(2000).optional(),
        })
        .strict(),
    }),
    async (req, res) => res.json({ data: await compliance.updateCase(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  r.post(
    '/cases/:id/report',
    casesManage,
    validate({
      params: idParam,
      body: z.object({ reference: z.string().trim().min(3).max(120), note: z.string().trim().max(4000).optional() }).strict(),
    }),
    async (req, res) => res.json({ data: await compliance.recordReport(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  r.post(
    '/cases/:id/risk-rating',
    casesManage,
    validate({ params: idParam, body: z.object({ riskRating: z.enum(['LOW', 'MEDIUM', 'HIGH']), reason: note }).strict() }),
    async (req, res) => res.json({ data: await compliance.setRiskRating(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  r.post(
    '/cases/:id/wallet',
    casesManage,
    validate({
      params: idParam,
      body: z.object({ currency: z.enum(['GHS', 'USD']).default('GHS'), frozen: z.boolean(), reason: note }).strict(),
    }),
    async (req, res) => res.json({ data: await compliance.setWalletFrozen(req.auth, req.params.id, req.body, ctx(req)) }),
  );
  return r;
}
