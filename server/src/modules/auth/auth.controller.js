import { requestContext } from '../../middleware/auth.js';

const ACCEPTED = 'If the details are valid, we have sent an email with next steps.';

/** HTTP adapters for auth. They translate requests to service calls and manage cookies. */
export function createAuthController({ authService, mfaService, sessionService, csrf }) {
  const setSessionCookie = (res, token) => res.cookie(sessionService.cookieName, token, sessionService.cookieOptions());
  const clearSessionCookie = (res) => {
    const { maxAge: _ignored, ...opts } = sessionService.cookieOptions();
    res.clearCookie(sessionService.cookieName, opts);
  };

  return {
    csrf(req, res) {
      res.set('Cache-Control', 'no-store').json({ data: { csrfToken: csrf.issue(req, res) } });
    },

    async register(req, res) {
      await authService.register(req.body, requestContext(req));
      res.status(202).json({ data: { message: 'Check your email to confirm your address and activate your account.' } });
    },

    async verifyEmail(req, res) {
      await authService.verifyEmail(req.body, requestContext(req));
      res.json({ data: { verified: true } });
    },

    async resendVerification(req, res) {
      await authService.resendVerification(req.body);
      res.status(202).json({ data: { message: ACCEPTED } });
    },

    async login(req, res) {
      const { token, mfaRequired } = await authService.login(req.body, requestContext(req));
      setSessionCookie(res, token);
      res.json({ data: { mfaRequired } });
    },

    async logout(req, res) {
      if (req.auth) await authService.logout(req.auth, requestContext(req));
      clearSessionCookie(res);
      res.status(204).end();
    },

    async forgotPassword(req, res) {
      await authService.forgotPassword(req.body, requestContext(req));
      res.status(202).json({ data: { message: ACCEPTED } });
    },

    async resetPassword(req, res) {
      await authService.resetPassword(req.body, requestContext(req));
      clearSessionCookie(res);
      res.json({ data: { reset: true } });
    },

    async changePassword(req, res) {
      await authService.changePassword(req.auth, req.body, requestContext(req));
      res.json({ data: { changed: true } });
    },

    async mfaStatus(req, res) {
      res.json({ data: await mfaService.status(req.auth.user.id) });
    },

    async mfaSetup(req, res) {
      res.set('Cache-Control', 'no-store').json({ data: await mfaService.setup(req.auth, req.body) });
    },

    async mfaEnable(req, res) {
      res.set('Cache-Control', 'no-store').json({ data: await mfaService.enable(req.auth, req.body, requestContext(req)) });
    },

    async mfaVerify(req, res) {
      try {
        res.json({ data: await mfaService.verifyChallenge(req.auth, req.body, requestContext(req)) });
      } catch (err) {
        if (err.code === 'MFA_LOCKED') clearSessionCookie(res);
        throw err;
      }
    },

    async mfaDisable(req, res) {
      await mfaService.disable(req.auth, req.body, requestContext(req));
      res.json({ data: { enabled: false } });
    },

    async mfaRecoveryCodes(req, res) {
      res
        .set('Cache-Control', 'no-store')
        .json({ data: await mfaService.regenerateRecoveryCodes(req.auth, req.body, requestContext(req)) });
    },
  };
}
