import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requireAuth, requirePermission } from '../../middleware/auth.js';
import { AppError } from '../../utils/errors.js';

const CATEGORIES = ['ACCOUNT', 'VERIFICATION', 'DEPOSITS', 'WITHDRAWALS', 'INVESTMENTS', 'TECHNICAL', 'COMPLAINT', 'OTHER'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'];
const idParam = z.object({ id: z.uuid() });
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const body = z.string().trim().min(1, 'Write a message').max(5000);

function uploads(maxBytes) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 3, fields: 10 } }).array('files', 3);
  return (req, res, next) =>
    upload(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE')
        return next(
          new AppError(`Files must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB`, { status: 413, code: 'FILE_TOO_LARGE' }),
        );
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
        return next(new AppError('Attach up to 3 files', { status: 400, code: 'TOO_MANY_FILES' }));
      return next(new AppError('The upload could not be read', { status: 400, code: 'UPLOAD_INVALID' }));
    });
}

function sendFile(res, { buffer, mimeType, filename }) {
  res
    .set({
      'Content-Type': mimeType,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${mimeType === 'application/pdf' ? 'attachment' : 'inline'}; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store, private',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    })
    .send(buffer);
}

/** Customer support (/api/v1/support) and the public FAQ (/api/v1/support/faqs). */
export function supportRoutes({ support, maxBytes }) {
  const r = Router();
  const own = requirePermission('support:tickets:own');
  const files = uploads(maxBytes);

  r.get('/faqs', async (_req, res) => res.set('Cache-Control', 'public, max-age=300').json({ data: await support.publishedFaqs() }));

  r.get('/tickets', own, validate({ query: z.object(paging) }), async (req, res) =>
    res.json(await support.listOwn(req.auth, req.validatedQuery)),
  );
  r.post(
    '/tickets',
    own,
    files,
    validate({
      body: z.object({
        category: z.enum(CATEGORIES),
        priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
        subject: z.string().trim().min(3, 'Add a short subject').max(200),
        body,
      }),
    }),
    async (req, res) => res.status(201).json({ data: await support.create(req.auth, req.body, req.files ?? [], requestContext(req)) }),
  );
  r.get('/tickets/:id', own, validate({ params: idParam }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await support.getOwn(req.auth, req.params.id) }),
  );
  r.post('/tickets/:id/messages', own, files, validate({ params: idParam, body: z.object({ body }) }), async (req, res) =>
    res.status(201).json({ data: await support.replyOwn(req.auth, req.params.id, req.body, req.files ?? [], requestContext(req)) }),
  );
  r.post('/tickets/:id/close', own, validate({ params: idParam }), async (req, res) =>
    res.json({ data: await support.closeOwn(req.auth, req.params.id, requestContext(req)) }),
  );
  r.get('/attachments/:id', requireAuth(), validate({ params: idParam }), async (req, res) => {
    // Same rule as requirePermission: staff access needs the permission and an MFA-verified session.
    const isSupportStaff = (await req.auth.permissions()).includes('support:tickets:read:any') && Boolean(req.auth.session.mfaVerifiedAt);
    sendFile(res, await support.attachment(req.auth, req.params.id, { isSupportStaff }));
  });
  return r;
}

/** Support desk for staff, mounted at /api/v1/admin/support. */
export function supportAdminRoutes({ support, maxBytes }) {
  const r = Router();
  const read = requirePermission('support:tickets:read:any');
  const manage = requirePermission('support:tickets:manage');
  const faq = requirePermission('support:faq:manage');
  const files = uploads(maxBytes);

  r.get(
    '/tickets',
    read,
    validate({
      query: z.object({
        status: z.enum(STATUSES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        category: z.enum(CATEGORIES).optional(),
        assignee: z.enum(['me', 'unassigned']).optional(),
        ...paging,
      }),
    }),
    async (req, res) => res.json(await support.queue({ ...req.validatedQuery, staffId: req.auth.user.id })),
  );
  r.get('/tickets/:id', read, validate({ params: idParam }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await support.getForStaff(req.params.id) }),
  );
  r.post(
    '/tickets/:id/messages',
    manage,
    files,
    validate({
      params: idParam,
      body: z.object({
        body,
        internal: z
          .enum(['true', 'false'])
          .default('false')
          .transform((v) => v === 'true'),
      }),
    }),
    async (req, res) =>
      res.status(201).json({ data: await support.replyStaff(req.auth, req.params.id, req.body, req.files ?? [], requestContext(req)) }),
  );
  r.patch(
    '/tickets/:id',
    manage,
    validate({
      params: idParam,
      body: z
        .object({
          status: z.enum(STATUSES).optional(),
          priority: z.enum(PRIORITIES).optional(),
          assigneeId: z.uuid().nullable().optional(),
          resolution: z.string().trim().max(2000).optional(),
        })
        .strict(),
    }),
    async (req, res) => res.json({ data: await support.updateStaff(req.auth, req.params.id, req.body, requestContext(req)) }),
  );
  r.get('/agents', read, async (_req, res) => res.json({ data: await support.agents() }));
  r.get(
    '/report',
    read,
    validate({
      query: z.object({
        from: z.iso.date().transform((s) => new Date(`${s}T00:00:00Z`)),
        to: z.iso.date().transform((s) => new Date(`${s}T00:00:00Z`)),
      }),
    }),
    async (req, res) => {
      const { from, to } = req.validatedQuery;
      res.json({ data: await support.report({ from, to: new Date(to.getTime() + 86_400_000) }) });
    },
  );

  const faqBody = z
    .object({
      category: z.string().trim().min(2).max(60),
      question: z.string().trim().min(5).max(300),
      answer: z.string().trim().min(5).max(5000),
      published: z.boolean().default(false),
      sortOrder: z.number().int().min(0).max(1000).default(0),
    })
    .strict();
  r.get('/faqs', faq, async (_req, res) => res.json({ data: await support.allFaqs() }));
  r.post('/faqs', faq, validate({ body: faqBody }), async (req, res) =>
    res.status(201).json({ data: await support.saveFaq(req.auth, null, req.body, requestContext(req)) }),
  );
  r.put('/faqs/:id', faq, validate({ params: idParam, body: faqBody }), async (req, res) =>
    res.json({ data: await support.saveFaq(req.auth, req.params.id, req.body, requestContext(req)) }),
  );
  r.delete('/faqs/:id', faq, validate({ params: idParam }), async (req, res) => {
    await support.deleteFaq(req.auth, req.params.id, requestContext(req));
    res.status(204).end();
  });
  return r;
}
