import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';
import { fromDecimalString } from '../../utils/money.js';

const decimal = z.string().regex(/^\d{1,13}(\.\d{1,4})?$/, 'Enter an amount like 50.00');

/** Investor referral dashboard, mounted at /api/v1/referrals. */
export function referralsRoutes({ referrals }) {
  const r = Router();
  r.get('/', requirePermission('referrals:read:own'), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await referrals.overview(req.auth.user.id) }),
  );
  return r;
}

/** Campaigns and held referrals, mounted at /api/v1/admin/referrals. */
export function referralsAdminRoutes({ referrals }) {
  const r = Router();
  const manage = requirePermission('referrals:manage');
  const idParam = z.object({ id: z.uuid() });

  r.get('/campaigns', manage, async (_req, res) => res.json({ data: await referrals.listCampaigns() }));
  r.post(
    '/campaigns',
    manage,
    validate({
      body: z
        .object({
          name: z.string().trim().min(3).max(120),
          description: z.string().trim().max(1000).optional(),
          currency: z.enum(['GHS']).default('GHS'),
          reward: decimal,
          minInvestment: decimal,
          maxRewardsPerReferrer: z.number().int().min(1).max(1000).optional(),
          startsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
          endsAt: z.iso
            .datetime({ offset: true })
            .transform((s) => new Date(s))
            .optional(),
        })
        .strict(),
    }),
    async (req, res) => {
      const { reward, minInvestment, ...rest } = req.body;
      const input = {
        ...rest,
        rewardMinor: fromDecimalString(reward, rest.currency).minor,
        minInvestmentMinor: fromDecimalString(minInvestment, rest.currency).minor,
      };
      res.status(201).json({ data: await referrals.createCampaign(req.auth, input, requestContext(req)) });
    },
  );
  r.post('/campaigns/:id/activate', manage, validate({ params: idParam }), async (req, res) =>
    res.json({ data: await referrals.setCampaignActive(req.auth, req.params.id, true, requestContext(req)) }),
  );
  r.post('/campaigns/:id/deactivate', manage, validate({ params: idParam }), async (req, res) =>
    res.json({ data: await referrals.setCampaignActive(req.auth, req.params.id, false, requestContext(req)) }),
  );
  r.get(
    '/',
    manage,
    validate({
      query: z.object({
        status: z.enum(['PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED', 'NOT_ELIGIBLE']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      }),
    }),
    async (req, res) => res.json(await referrals.listReferrals(req.validatedQuery)),
  );
  r.post(
    '/:id/decide',
    manage,
    validate({ params: idParam, body: z.object({ approve: z.boolean(), note: z.string().trim().min(5).max(500) }).strict() }),
    async (req, res) => res.json({ data: await referrals.decide(req.auth, req.params.id, req.body, requestContext(req)) }),
  );
  return r;
}
