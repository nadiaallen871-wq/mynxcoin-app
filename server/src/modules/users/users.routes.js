import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requestContext } from '../../middleware/auth.js';

const name = z.string().trim().min(1).max(100);
const profileSchema = z
  .object({
    firstName: name.optional(),
    lastName: name.optional(),
    organizationName: z.string().trim().min(2).max(200).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

const uuidParam = z.object({ id: z.uuid() });

/** /api/v1/users: the signed-in user's own account. */
export function usersRoutes({ usersService, verificationLimiter }) {
  const r = Router();
  const ctx = requestContext;

  // Like /me, but answers 200 with null for anonymous visitors, so the SPA can
  // check for a session without producing 401 errors on every public page.
  r.get('/session', async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ data: req.auth ? await usersService.me(req.auth) : null });
  });

  r.get('/me', requireAuth({ allowMfaPending: true }), async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ data: await usersService.me(req.auth) });
  });

  r.patch('/me', requireAuth(), validate({ body: profileSchema }), async (req, res) => {
    res.json({ data: await usersService.updateProfile(req.auth, req.body, ctx(req)) });
  });

  r.post(
    '/me/phone',
    requireAuth(),
    verificationLimiter,
    validate({ body: z.object({ phone: z.string().min(9).max(20) }) }),
    async (req, res) => {
      res.status(202).json({ data: await usersService.startPhoneVerification(req.auth, req.body, ctx(req)) });
    },
  );

  r.post(
    '/me/phone/verify',
    requireAuth(),
    verificationLimiter,
    validate({ body: z.object({ code: z.string().regex(/^\d{6}$/) }) }),
    async (req, res) => {
      res.json({ data: await usersService.verifyPhone(req.auth, req.body, ctx(req)) });
    },
  );

  r.get('/me/sessions', requireAuth(), async (req, res) => {
    res.json({ data: await usersService.listSessions(req.auth) });
  });

  r.delete('/me/sessions/:id', requireAuth(), validate({ params: uuidParam }), async (req, res) => {
    const { current } = await usersService.revokeSession(req.auth, req.params.id, ctx(req));
    res.json({ data: { revoked: true, current } });
  });

  r.post('/me/sessions/revoke-others', requireAuth(), async (req, res) => {
    res.json({ data: await usersService.revokeOtherSessions(req.auth, ctx(req)) });
  });

  r.get('/me/login-history', requireAuth(), async (req, res) => {
    res.json({ data: await usersService.loginHistory(req.auth) });
  });

  return r;
}
