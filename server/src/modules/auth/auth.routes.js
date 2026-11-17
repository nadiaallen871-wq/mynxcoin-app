import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as s from './auth.schemas.js';

/**
 * /api/v1/auth. `authLimiter` (per IP) guards every credential-accepting
 * endpoint, on top of per-account lockout.
 */
export function authRoutes({ controller, authLimiter }) {
  const r = Router();

  r.get('/csrf', controller.csrf);

  r.post('/register', authLimiter, validate({ body: s.registerSchema }), controller.register);
  r.post('/verify-email', authLimiter, validate({ body: s.tokenSchema }), controller.verifyEmail);
  r.post('/resend-verification', authLimiter, validate({ body: s.emailOnlySchema }), controller.resendVerification);
  r.post('/login', authLimiter, validate({ body: s.loginSchema }), controller.login);
  r.post('/logout', controller.logout);
  r.post('/forgot-password', authLimiter, validate({ body: s.emailOnlySchema }), controller.forgotPassword);
  r.post('/reset-password', authLimiter, validate({ body: s.resetPasswordSchema }), controller.resetPassword);
  r.post('/password', requireAuth(), authLimiter, validate({ body: s.changePasswordSchema }), controller.changePassword);

  r.get('/mfa', requireAuth(), controller.mfaStatus);
  r.post('/mfa/setup', requireAuth(), authLimiter, validate({ body: s.mfaSetupSchema }), controller.mfaSetup);
  r.post('/mfa/enable', requireAuth(), authLimiter, validate({ body: s.mfaEnableSchema }), controller.mfaEnable);
  r.post(
    '/mfa/verify',
    requireAuth({ allowMfaPending: true }),
    authLimiter,
    validate({ body: s.mfaChallengeSchema }),
    controller.mfaVerify,
  );
  r.post('/mfa/disable', requireAuth(), authLimiter, validate({ body: s.mfaStepUpSchema }), controller.mfaDisable);
  r.post('/mfa/recovery-codes', requireAuth(), authLimiter, validate({ body: s.mfaStepUpSchema }), controller.mfaRecoveryCodes);

  return r;
}
