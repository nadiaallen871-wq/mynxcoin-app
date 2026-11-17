import { AppError, NotFoundError } from '../utils/errors.js';

export function notFoundHandler() {
  return (req, _res, next) => next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
}

/**
 * Converts every error into the standard envelope. Internal details are never
 * exposed for 5xx responses. They go to the structured log with the request ID.
 */
export function errorHandler({ logger }) {
  // Express identifies error middleware by its four-argument signature.
  return (err, req, res, _next) => {
    let error = err;

    if (!(error instanceof AppError)) {
      if (error?.type === 'entity.parse.failed') {
        error = new AppError('Malformed JSON body', { status: 400, code: 'MALFORMED_JSON' });
      } else if (error?.type === 'entity.too.large') {
        error = new AppError('Request body too large', { status: 413, code: 'PAYLOAD_TOO_LARGE' });
      } else if (error?.code === 'CORS_REJECTED') {
        error = new AppError('Origin not allowed', { status: 403, code: 'CORS_REJECTED' });
      } else {
        error = new AppError('An unexpected error occurred', { cause: err });
      }
    }

    const log = req.log ?? logger;
    if (error.status >= 500) {
      log.error({ err, requestId: req.id }, 'Request failed');
    } else {
      log.warn({ code: error.code, status: error.status, requestId: req.id }, error.message);
    }

    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.expose ? error.message : 'An unexpected error occurred',
        ...(error.details && error.expose ? { details: error.details } : {}),
        requestId: req.id,
      },
    });
  };
}
