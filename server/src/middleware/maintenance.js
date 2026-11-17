import { AppError } from '../utils/errors.js';

/**
 * Blocks investor money-moving writes while `platform.maintenance_mode` is on.
 * Reads, sign-in, webhooks (money already in flight) and staff tools keep working.
 */
export function maintenanceGuard({ settings }) {
  return async (_req, _res, next) => {
    try {
      if (await settings.get('platform.maintenance_mode')) {
        return next(
          new AppError('Deposits, withdrawals and new investments are paused for scheduled maintenance. Please try again later.', {
            status: 503,
            code: 'MAINTENANCE',
          }),
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
