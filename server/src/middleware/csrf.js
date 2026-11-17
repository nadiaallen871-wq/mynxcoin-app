import { randomToken, safeEqual } from '../utils/crypto.js';
import { AppError } from '../utils/errors.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Double-submit CSRF protection. GET /auth/csrf sets an httpOnly cookie and
 * returns the same random token in the body. The SPA keeps it in memory and
 * sends it as X-CSRF-Token on every state-changing request. A cross-site page
 * can neither read the response (CORS) nor set the header, and SameSite=Lax
 * cookies add a second layer.
 *
 * Paths in `exempt` (provider webhooks, authenticated by signature) are skipped.
 */
export function createCsrf({ isProduction, exempt = [] }) {
  const cookieName = isProduction ? '__Host-mynx_csrf' : 'mynx_csrf';
  const cookieOptions = { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' };

  return {
    cookieName,

    issue(req, res) {
      const existing = req.cookies?.[cookieName];
      const token = typeof existing === 'string' && existing.length >= 32 && existing.length <= 64 ? existing : randomToken(32);
      res.cookie(cookieName, token, cookieOptions);
      return token;
    },

    protect() {
      return (req, _res, next) => {
        if (!UNSAFE.has(req.method)) return next();
        if (exempt.some((pattern) => pattern.test(req.originalUrl))) return next();
        const cookie = req.cookies?.[cookieName];
        const header = req.get('x-csrf-token');
        if (!cookie || !header || !safeEqual(cookie, header)) {
          return next(
            new AppError('Security token missing or invalid. Refresh the page and try again.', { status: 403, code: 'CSRF_INVALID' }),
          );
        }
        return next();
      };
    },
  };
}
