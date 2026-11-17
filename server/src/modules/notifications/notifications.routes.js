import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { NOTIFICATION_CATEGORIES } from './templates.js';

/** The signed-in user's notification centre and preferences, mounted at /api/v1/notifications. */
export function notificationsRoutes({ notifications }) {
  const r = Router();
  r.use(requireAuth());

  r.get(
    '/',
    validate({
      query: z.object({
        unread: z.enum(['true', 'false']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      }),
    }),
    async (req, res) => {
      const { unread, page, pageSize } = req.validatedQuery;
      res.json(await notifications.list(req.auth.user.id, { unreadOnly: unread === 'true', page, pageSize }));
    },
  );
  r.get('/unread-count', async (req, res) => res.json({ data: { count: await notifications.unreadCount(req.auth.user.id) } }));
  r.post('/read', validate({ body: z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict() }), async (req, res) =>
    res.json({ data: { updated: await notifications.markRead(req.auth.user.id, req.body.ids) } }),
  );
  r.post('/read-all', async (req, res) => res.json({ data: { updated: await notifications.markAllRead(req.auth.user.id) } }));
  r.get('/preferences', async (req, res) => res.json({ data: await notifications.preferences(req.auth.user.id) }));
  r.put(
    '/preferences',
    validate({
      body: z
        .object({
          preferences: z
            .array(
              z.object({ category: z.enum(NOTIFICATION_CATEGORIES), email: z.boolean(), sms: z.boolean(), inApp: z.boolean() }).strict(),
            )
            .min(1)
            .max(NOTIFICATION_CATEGORIES.length),
        })
        .strict(),
    }),
    async (req, res) => res.json({ data: await notifications.updatePreferences(req.auth.user.id, req.body.preferences) }),
  );
  return r;
}
