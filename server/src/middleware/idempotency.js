import { createHash } from 'node:crypto';
import { AppError } from '../utils/errors.js';

const KEY = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * HTTP idempotency for financial POSTs. The client sends a unique
 * `Idempotency-Key` per intended operation (the SPA generates a UUID per form submission).
 *
 * - First request: recorded as IN_PROGRESS, processed, and the response stored.
 * - Retry with the same key and body: the stored response is replayed (`Idempotency-Replayed: true`).
 * - Same key with a different body: 422 IDEMPOTENCY_KEY_REUSED.
 * - Retry while the first is still running: 409 IDEMPOTENCY_IN_PROGRESS.
 * - 5xx responses are not stored, so a genuine retry can succeed.
 *
 * Keys are scoped per user and expire after `ttlHours`. Must run after requireAuth.
 * Ledger postings carry their own idempotency keys as a second layer.
 */
export function idempotency({ prisma, ttlHours = 24 }) {
  return async (req, res, next) => {
    const key = req.get('idempotency-key');
    if (!key)
      return next(new AppError('Idempotency-Key header is required for this request', { status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' }));
    if (!KEY.test(key))
      return next(
        new AppError('Idempotency-Key must be 16–128 letters, digits, "-" or "_"', { status: 400, code: 'IDEMPOTENCY_KEY_INVALID' }),
      );

    const userId = req.auth.user.id;
    const path = req.originalUrl.split('?')[0];
    const requestHash = createHash('sha256')
      .update(`${req.method} ${path}\n${JSON.stringify(req.body ?? {})}`)
      .digest('hex');

    const claim = () =>
      prisma.idempotencyKey.create({
        data: { key, userId, method: req.method, path, requestHash, expiresAt: new Date(Date.now() + ttlHours * 3_600_000) },
      });

    let record;
    try {
      record = await claim();
    } catch (err) {
      if (err.code !== 'P2002') return next(err);
      const existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (existing && existing.expiresAt <= new Date()) {
        await prisma.idempotencyKey.deleteMany({ where: { id: existing.id } });
        try {
          record = await claim();
        } catch (e) {
          return next(
            e.code === 'P2002'
              ? new AppError('A request with this key is already being processed', { status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' })
              : e,
          );
        }
      } else if (!existing) {
        return next(new AppError('A request with this key is already being processed', { status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' }));
      } else if (existing.requestHash !== requestHash || existing.path !== path) {
        return next(
          new AppError('This Idempotency-Key was already used with a different request', { status: 422, code: 'IDEMPOTENCY_KEY_REUSED' }),
        );
      } else if (existing.status === 'IN_PROGRESS') {
        res.set('Retry-After', '1');
        return next(new AppError('A request with this key is already being processed', { status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' }));
      } else {
        return res.status(existing.responseStatus).set('Idempotency-Replayed', 'true').json(existing.responseBody);
      }
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode;
      const persist =
        status >= 500
          ? prisma.idempotencyKey.deleteMany({ where: { id: record.id } })
          : prisma.idempotencyKey.update({
              where: { id: record.id },
              data: { status: 'COMPLETED', responseStatus: status, responseBody: body ?? null },
            });
      persist.catch((err) => req.log?.error({ err }, 'failed to persist idempotency record')).finally(() => originalJson(body));
      return res;
    };
    return next();
  };
}
