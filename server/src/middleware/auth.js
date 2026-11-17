import { AppError, ForbiddenError, UnauthorizedError } from '../utils/errors.js';

/** Permissions scoped to the actor's own records. Every other permission is a staff permission. */
export const isStaffPermission = (key) => !key.endsWith(':own');

/**
 * Resolves the session cookie into `req.auth = { user, session, permissions() }`.
 * Never rejects a request. The `require*` guards below do that.
 */
export function authenticate({ sessionService, usersRepository }) {
  return async (req, _res, next) => {
    req.auth = null;
    const token = req.cookies?.[sessionService.cookieName];
    if (!token) return next();
    const resolved = await sessionService.resolve(token);
    if (!resolved) return next();
    let cached;
    req.auth = {
      ...resolved,
      mfaPending: resolved.session.mfaRequired && !resolved.session.mfaVerifiedAt,
      // Loaded at most once per request, and only when a guard needs it.
      permissions: async () => (cached ??= await usersRepository.permissionKeys(resolved.user.id)),
    };
    return next();
  };
}

export function requireAuth({ allowMfaPending = false } = {}) {
  return (req, _res, next) => {
    if (!req.auth) return next(new UnauthorizedError());
    if (req.auth.mfaPending && !allowMfaPending) {
      return next(new AppError('Two-factor verification required', { status: 401, code: 'MFA_REQUIRED' }));
    }
    return next();
  };
}

/**
 * Requires every listed permission (checked on the server for every request).
 * Staff permissions additionally require MFA to be enabled on the account:
 * back-office access with a password alone is not allowed.
 */
export function requirePermission(...keys) {
  const needsStaffMfa = keys.some(isStaffPermission);
  return async (req, res, next) => {
    try {
      await new Promise((resolve, reject) => requireAuth()(req, res, (err) => (err ? reject(err) : resolve())));
      const granted = new Set(await req.auth.permissions());
      if (!keys.every((key) => granted.has(key))) return next(new ForbiddenError());
      if (needsStaffMfa && !req.auth.session.mfaVerifiedAt) {
        return next(
          new AppError('Enable two-factor authentication to access staff tools', { status: 403, code: 'MFA_ENROLLMENT_REQUIRED' }),
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Request metadata passed to services for auditing and security checks. */
export function requestContext(req) {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null, requestId: req.id ?? null };
}
