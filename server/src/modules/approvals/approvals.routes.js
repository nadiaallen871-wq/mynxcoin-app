import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';

const reason = z.string().trim().min(10, 'Explain why (at least 10 characters)').max(1000);

/** Approval requests (/api/v1/admin/approvals) and system settings (/api/v1/admin/settings). */
export function approvalsRoutes({ approvals, settingsAdmin }) {
  const r = Router();
  const idParam = z.object({ id: z.uuid() });

  r.get(
    '/approvals',
    requirePermission('admin:dashboard'),
    validate({
      query: z.object({
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED', 'ALL']).default('PENDING'),
        type: z.enum(['SETTING_CHANGE', 'ROLE_GRANT']).optional(),
        mine: z.enum(['true', 'false']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
    }),
    async (req, res) =>
      res.json(await approvals.list({ ...req.validatedQuery, mine: req.validatedQuery.mine === 'true', staffId: req.auth.user.id })),
  );
  r.get('/approvals/:id', requirePermission('admin:dashboard'), validate({ params: idParam }), async (req, res) =>
    res.json({ data: await approvals.get(req.params.id) }),
  );
  r.post(
    '/approvals/:id/decide',
    requirePermission('approvals:decide'),
    validate({ params: idParam, body: z.object({ approve: z.boolean(), note: z.string().trim().min(3).max(1000) }).strict() }),
    async (req, res) => res.json({ data: await approvals.decide(req.auth, req.params.id, req.body, requestContext(req)) }),
  );
  r.post('/approvals/:id/cancel', requirePermission('admin:dashboard'), validate({ params: idParam }), async (req, res) =>
    res.json({ data: await approvals.cancel(req.auth, req.params.id, requestContext(req)) }),
  );

  r.get('/settings', requirePermission('settings:read'), async (_req, res) => res.json({ data: await settingsAdmin.list() }));
  r.post(
    '/settings/:key/proposals',
    requirePermission('settings:manage'),
    validate({
      params: z.object({ key: z.string().regex(/^[a-z_]+\.[a-z_]+$/) }),
      body: z.object({ value: z.union([z.boolean(), z.number().int(), z.string().max(500)]), reason }).strict(),
    }),
    async (req, res) =>
      res.status(202).json({ data: await settingsAdmin.propose(req.auth, req.params.key, req.body, requestContext(req)) }),
  );
  return r;
}
