import { Router } from 'express';

export function healthRoutes({ healthService }) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(healthService.liveness());
  });

  router.get('/ready', async (_req, res) => {
    const { ready, body } = await healthService.readiness();
    res
      .set('Cache-Control', 'no-store')
      .status(ready ? 200 : 503)
      .json(body);
  });

  return router;
}
