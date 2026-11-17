import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';

const date = z.iso.date();

/** Risk, BI and fee views (/api/v1/admin/insights) and tax rules (/api/v1/admin/tax). */
export function insightsRoutes({ insights, tax }) {
  const r = Router();
  const reports = requirePermission('reports:read');
  const compliance = requirePermission('compliance:cases:read');

  r.get(
    '/insights/concentration',
    reports,
    validate({ query: z.object({ currency: z.enum(['GHS', 'USD']).default('GHS') }) }),
    async (req, res) => res.json({ data: await insights.concentration(req.validatedQuery) }),
  );
  r.get('/insights/fees', reports, async (_req, res) => res.json({ data: await insights.feeSchedule() }));
  r.get(
    '/insights/kpis',
    reports,
    validate({
      query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12), currency: z.enum(['GHS', 'USD']).default('GHS') }),
    }),
    async (req, res) => res.json({ data: await insights.kpis(req.validatedQuery) }),
  );
  r.get('/insights/risk-scores', compliance, async (_req, res) => res.json({ data: await insights.topRisk() }));
  r.get('/insights/risk-scores/:userId', compliance, validate({ params: z.object({ userId: z.uuid() }) }), async (req, res) =>
    res.json({ data: await insights.riskScore(req.params.userId) }),
  );

  r.get('/tax/rules', requirePermission('reports:read'), async (_req, res) => res.json({ data: await tax.list() }));
  r.post(
    '/tax/rules',
    requirePermission('tax:rules:manage'),
    validate({
      body: z
        .object({
          jurisdiction: z.string().regex(/^[A-Z]{2}$/),
          incomeType: z.enum(['INTEREST', 'CAPITAL_GAIN', 'REFERRAL_REWARD']),
          investorType: z.enum(['INDIVIDUAL', 'INSTITUTIONAL']).nullable().optional(),
          ratePercent: z.string().regex(/^\d{1,2}(\.\d{1,4})?$/, 'Enter a percentage like 8 or 7.5'),
          effectiveFrom: date,
          effectiveTo: date.optional(),
          description: z.string().trim().min(5).max(500),
          legalReference: z.string().trim().min(3, 'Cite the law, guidance or adviser opinion').max(300),
          reason: z.string().trim().min(10).max(1000),
        })
        .strict(),
    }),
    async (req, res) => {
      const { ratePercent, ...rest } = req.body;
      // Percent → fraction as an exact decimal string: "7.5" → "0.075".
      const [w, f = ''] = ratePercent.split('.');
      const digits = `${w}${f}`.replace(/^0+(?=\d)/, '');
      const scale = f.length + 2;
      const padded = digits.padStart(scale + 1, '0');
      const rate = `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
      res.status(202).json({ data: await tax.propose(req.auth, { ...rest, rate }, requestContext(req)) });
    },
  );
  r.post(
    '/tax/rules/:id/deactivate',
    requirePermission('tax:rules:manage'),
    validate({ params: z.object({ id: z.uuid() }), body: z.object({ reason: z.string().trim().min(10).max(1000) }).strict() }),
    async (req, res) =>
      res.status(202).json({ data: await tax.proposeDeactivation(req.auth, req.params.id, req.body, requestContext(req)) }),
  );
  return r;
}
