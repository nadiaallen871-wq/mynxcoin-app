import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requirePermission } from '../../middleware/auth.js';
import { AppError } from '../../utils/errors.js';

const PRODUCT_TYPES = [
  'TREASURY_BILL',
  'GOVERNMENT_BOND',
  'CORPORATE_BOND',
  'FIXED_DEPOSIT',
  'MONEY_MARKET_FUND',
  'FIXED_INCOME_FUND',
  'EQUITY_FUND',
  'BALANCED_FUND',
  'REAL_ESTATE',
  'OTHER',
];
const STATUSES = ['DRAFT', 'PUBLISHED', 'SUSPENDED', 'CLOSED', 'ARCHIVED'];
const RISK_PROFILES = ['CONSERVATIVE', 'MODERATELY_CONSERVATIVE', 'BALANCED', 'GROWTH', 'AGGRESSIVE'];
const DOC_KINDS = ['KEY_INFORMATION', 'TERM_SHEET', 'PROSPECTUS', 'RISK_DISCLOSURE', 'ANNUAL_REPORT', 'OTHER'];

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
  .max(100);
const decimalAmount = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Enter an amount like 500 or 500.00');
const percent = (max) =>
  z
    .string()
    .regex(/^\d{1,3}(\.\d{1,4})?$/, 'Enter a percentage like 12.5')
    .refine((v) => Number(v) <= max, `Must be at most ${max}%`);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullable = (s) => s.nullable().optional();

const productFields = {
  name: z.string().trim().min(3).max(160),
  shortDescription: z.string().trim().min(10).max(300),
  description: z.string().trim().min(1).max(20_000),
  categorySlug: slug,
  productType: z.enum(PRODUCT_TYPES),
  issuerName: z.string().trim().min(2).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/),
  minInvestment: decimalAmount,
  maxInvestment: nullable(decimalAmount),
  increment: nullable(decimalAmount),
  capacity: nullable(decimalAmount),
  returnType: z.enum(['FIXED', 'TARGET', 'NONE']),
  annualRatePercent: nullable(percent(100)),
  termDays: nullable(z.number().int().min(1).max(36_500)),
  maturityDate: nullable(isoDate),
  lockupDays: nullable(z.number().int().min(0).max(36_500)),
  redemptionTerms: z.string().trim().min(10).max(2000),
  entryFeePercent: percent(20).optional(),
  managementFeePercent: percent(20).optional(),
  earlyExitFeePercent: percent(20).optional(),
  feeNotes: nullable(z.string().trim().max(1000)),
  riskLevel: z.number().int().min(1).max(7),
  minRiskProfile: z.enum(RISK_PROFILES),
  riskDisclosure: z.string().trim().min(1).max(20_000),
  eligibleInvestorTypes: z
    .array(z.enum(['INDIVIDUAL', 'INSTITUTIONAL']))
    .min(1)
    .max(2),
  subscriptionOpensAt: nullable(z.iso.datetime({ offset: true })),
  subscriptionClosesAt: nullable(z.iso.datetime({ offset: true })),
};

const createSchema = z.object({ slug: slug.optional(), ...productFields }).strict();
const updateSchema = z
  .object(Object.fromEntries(Object.entries(productFields).map(([k, v]) => [k, v.optional()])))
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

const idParam = z.object({ id: z.uuid() });

/** /api/v1/investments: the public catalogue (works signed in or out). */
export function investmentsRoutes({ productsService }) {
  const r = Router();

  r.get('/categories', async (_req, res) =>
    res.set('Cache-Control', 'public, max-age=60').json({ data: await productsService.categories() }),
  );

  r.get(
    '/',
    validate({
      query: z.object({
        search: z.string().trim().max(100).optional(),
        category: slug.optional(),
        type: z.enum(PRODUCT_TYPES).optional(),
        maxRiskLevel: z.coerce.number().int().min(1).max(7).optional(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional(),
        availability: z.enum(['OPEN', 'UPCOMING', 'CLOSED']).optional(),
        sort: z.enum(['newest', 'name', 'min_investment', 'risk_low', 'risk_high', 'term', 'closing']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(12),
      }),
    }),
    async (req, res) => res.json(await productsService.listPublic(req.validatedQuery)),
  );

  r.post(
    '/calculator',
    validate({
      body: z
        .object({
          slug: slug.optional(),
          amount: decimalAmount,
          days: z.number().int().min(1).max(36_500).optional(),
          annualRatePercent: percent(100).optional(),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
          entryFeePercent: percent(20).optional(),
          managementFeePercent: percent(20).optional(),
        })
        .strict(),
    }),
    async (req, res) => res.json({ data: await productsService.calculate(req.body) }),
  );

  r.get('/:slug', validate({ params: z.object({ slug }) }), async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ data: await productsService.getPublic(req.params.slug, req.auth) });
  });

  r.get('/:slug/documents/:docId', validate({ params: z.object({ slug, docId: z.uuid() }) }), async (req, res) => {
    const { buffer, mimeType, filename } = await productsService.documentFile(req.params.slug, req.params.docId);
    res
      .set({
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(buffer);
  });

  return r;
}

/** /api/v1/admin/products: staff product management. */
export function productsAdminRoutes({ productsService, maxBytes }) {
  const r = Router();
  const read = requirePermission('products:read:any');
  const manage = requirePermission('products:manage');
  const publish = requirePermission('products:publish');
  const s = productsService;
  const ctx = requestContext;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 5 } }).single('file');
  const handleUpload = (req, res, next) =>
    upload(req, res, (err) =>
      err
        ? next(
            new AppError(err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : 'The upload could not be read', {
              status: err.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
              code: err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_INVALID',
            }),
          )
        : next(),
    );

  r.get('/categories', read, async (_req, res) => res.json({ data: await s.listAllCategories() }));
  r.post(
    '/categories',
    manage,
    validate({
      body: z
        .object({
          slug: slug.optional(),
          name: z.string().trim().min(2).max(120),
          description: z.string().trim().max(500).optional(),
          sortOrder: z.number().int().min(0).max(10_000).optional(),
        })
        .strict(),
    }),
    async (req, res) => res.status(201).json({ data: await s.createCategory(req.auth, req.body, ctx(req)) }),
  );
  r.patch(
    '/categories/:id',
    manage,
    validate({
      params: idParam,
      body: z
        .object({
          name: z.string().trim().min(2).max(120).optional(),
          description: z.string().trim().max(500).nullable().optional(),
          sortOrder: z.number().int().min(0).max(10_000).optional(),
          isActive: z.boolean().optional(),
        })
        .strict(),
    }),
    async (req, res) => res.json({ data: await s.updateCategory(req.auth, req.params.id, req.body, ctx(req)) }),
  );

  r.get(
    '/',
    read,
    validate({
      query: z.object({
        status: z.enum(STATUSES).optional(),
        search: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
    }),
    async (req, res) => res.json(await s.listAll(req.validatedQuery)),
  );
  r.post('/', manage, validate({ body: createSchema }), async (req, res) =>
    res.status(201).json({ data: await s.create(req.auth, req.body, ctx(req)) }),
  );
  r.get('/:id', read, validate({ params: idParam }), async (req, res) => res.json({ data: await s.get(req.params.id) }));
  r.patch('/:id', manage, validate({ params: idParam, body: updateSchema }), async (req, res) =>
    res.json({ data: await s.update(req.auth, req.params.id, req.body, ctx(req)) }),
  );

  r.post('/:id/publish', publish, validate({ params: idParam }), async (req, res) =>
    res.json({ data: await s.transition(req.auth, req.params.id, 'publish', {}, ctx(req)) }),
  );
  r.post(
    '/:id/suspend',
    publish,
    validate({ params: idParam, body: z.object({ reason: z.string().trim().min(10).max(500) }) }),
    async (req, res) => res.json({ data: await s.transition(req.auth, req.params.id, 'suspend', req.body, ctx(req)) }),
  );
  r.post(
    '/:id/close',
    publish,
    validate({ params: idParam, body: z.object({ reason: z.string().trim().max(500).optional() }) }),
    async (req, res) => res.json({ data: await s.transition(req.auth, req.params.id, 'close', req.body, ctx(req)) }),
  );
  r.post(
    '/:id/archive',
    publish,
    validate({ params: idParam, body: z.object({ reason: z.string().trim().max(500).optional() }) }),
    async (req, res) => res.json({ data: await s.transition(req.auth, req.params.id, 'archive', req.body, ctx(req)) }),
  );

  r.post(
    '/:id/documents',
    manage,
    handleUpload,
    validate({ params: idParam, body: z.object({ kind: z.enum(DOC_KINDS), title: z.string().trim().min(3).max(200) }) }),
    async (req, res) =>
      res.status(201).json({ data: await s.addDocument(req.auth, req.params.id, { ...req.body, file: req.file }, ctx(req)) }),
  );
  r.delete('/:id/documents/:docId', manage, validate({ params: idParam.extend({ docId: z.uuid() }) }), async (req, res) =>
    res.json({ data: await s.removeDocument(req.auth, req.params.id, req.params.docId, ctx(req)) }),
  );
  r.post(
    '/:id/performance',
    manage,
    validate({
      params: idParam,
      body: z
        .object({
          periodStart: isoDate,
          periodEnd: isoDate,
          returnPercent: z.string().regex(/^-?\d{1,4}(\.\d{1,4})?$/, 'Enter a percentage like 18.2 or -3.5'),
          source: z.string().trim().min(5, 'Name the source (e.g. "Audited annual report 2025")').max(300),
          sourceUrl: z.url().max(500).optional(),
        })
        .strict(),
    }),
    async (req, res) => res.status(201).json({ data: await s.addPerformance(req.auth, req.params.id, req.body, ctx(req)) }),
  );

  return r;
}
