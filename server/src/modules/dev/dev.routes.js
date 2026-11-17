import { Router } from 'express';

/**
 * Development-only endpoints. They are mounted only when NODE_ENV=development
 * (see app.js), so they are never reachable in test, staging or production.
 *
 * GET /api/v1/dev/outbox shows recent sandbox emails and SMS (including
 * verification links), so flows can be completed locally without a provider.
 */
export function devRoutes({ prisma }) {
  const r = Router();
  r.get('/outbox', async (_req, res) => {
    const rows = await prisma.outboundMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, channel: true, recipient: true, template: true, subject: true, body: true, status: true, createdAt: true },
    });
    res.set('Cache-Control', 'no-store').json({ data: rows });
  });
  return r;
}
