import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requestContext, requireAuth, requirePermission } from '../../middleware/auth.js';
import { AppError } from '../../utils/errors.js';
import { DOCUMENT_TYPES } from '../onboarding/onboarding.constants.js';

/** /api/v1/documents: KYC document upload, listing and signed downloads. */
export function documentsRoutes({ documentsService, maxBytes }) {
  const r = Router();
  // Memory storage: the file is validated and encrypted before it touches disk.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 5 } }).single('file');
  const handleUpload = (req, res, next) =>
    upload(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE')
        return next(
          new AppError(`Files must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB`, { status: 413, code: 'FILE_TOO_LARGE' }),
        );
      return next(new AppError('The upload could not be read', { status: 400, code: 'UPLOAD_INVALID' }));
    });

  r.get('/', requirePermission('documents:read:own'), async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ data: await documentsService.list(req.auth) });
  });

  r.post(
    '/',
    requirePermission('kyc:submit:own'),
    handleUpload,
    validate({ body: z.object({ type: z.enum(DOCUMENT_TYPES) }) }),
    async (req, res) => {
      res.status(201).json({ data: await documentsService.upload(req.auth, { type: req.body.type, file: req.file }, requestContext(req)) });
    },
  );

  r.delete('/:id', requirePermission('kyc:submit:own'), validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
    await documentsService.remove(req.auth, req.params.id, requestContext(req));
    res.status(204).end();
  });

  // Owner or compliance staff. The service decides, and both cases are logged.
  r.get('/:id/download-url', requireAuth(), validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json({ data: await documentsService.issueDownloadUrl(req.auth, req.params.id, requestContext(req)) });
  });

  r.get('/download', requireAuth(), validate({ query: z.object({ token: z.string().min(20).max(600) }) }), async (req, res) => {
    const { buffer, mimeType, filename } = await documentsService.download(req.auth, req.validatedQuery.token, requestContext(req));
    res
      .set({
        'Content-Type': mimeType,
        'Content-Length': String(buffer.length),
        // Images display inline. PDFs download, so no PDF viewer runs on our origin.
        'Content-Disposition': `${mimeType === 'application/pdf' ? 'attachment' : 'inline'}; filename="${filename.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store, private',
        // Inline images render in a sandboxed, script-free context even though they are served from our origin.
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      })
      .send(buffer);
  });

  return r;
}
