import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';

const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED', 'APPROVED', 'REJECTED'];
const idParam = z.object({ id: z.uuid() });

/** /api/v1/kyc: investor submission. */
export function kycRoutes({ kycService }) {
  const r = Router();
  r.post('/submit', requirePermission('kyc:submit:own'), async (req, res) => {
    res.status(201).json({ data: await kycService.submit(req.auth, requestContext(req)) });
  });
  return r;
}

/** /api/v1/admin/kyc: compliance review queue. */
export function kycAdminRoutes({ kycService, documentsService }) {
  const r = Router();
  const read = requirePermission('kyc:read:any');
  const review = requirePermission('kyc:review');

  r.get(
    '/applications',
    read,
    validate({
      query: z.object({
        status: z.enum(STATUSES).optional(),
        search: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
    }),
    async (req, res) => res.json(await kycService.list(req.validatedQuery)),
  );

  r.get('/applications/:id', read, validate({ params: idParam }), async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ data: await kycService.get(req.params.id, documentsService) });
  });

  r.post('/applications/:id/claim', review, validate({ params: idParam }), async (req, res) => {
    await kycService.claim(req.auth, req.params.id, requestContext(req));
    res.json({ data: await kycService.get(req.params.id, documentsService) });
  });

  r.post('/applications/:id/release', review, validate({ params: idParam }), async (req, res) => {
    await kycService.release(req.auth, req.params.id, requestContext(req));
    res.json({ data: await kycService.get(req.params.id, documentsService) });
  });

  r.post(
    '/applications/:id/decision',
    review,
    validate({
      params: idParam,
      body: z
        .object({
          decision: z.enum(['APPROVE', 'REQUEST_RESUBMISSION', 'REJECT']),
          reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(2000),
          riskRating: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
          screeningCleared: z.boolean().optional(),
          documents: z
            .array(z.object({ id: z.uuid(), status: z.enum(['ACCEPTED', 'REJECTED']), reason: z.string().trim().max(500).optional() }))
            .max(20)
            .optional(),
        })
        .strict(),
    }),
    async (req, res) => {
      await kycService.decide(req.auth, req.params.id, req.body, requestContext(req));
      res.json({ data: await kycService.get(req.params.id, documentsService) });
    },
  );

  return r;
}
