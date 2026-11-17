import { Router } from 'express';

export function platformRoutes({ platformService }) {
  const router = Router();
  router.get('/', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60').json({ data: await platformService.info() });
  });
  return router;
}
