import { randomUUID } from 'node:crypto';

const INBOUND_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Assigns a request ID (reusing a well-formed inbound X-Request-Id from a
 * trusted proxy) and echoes it on the response for support correlation.
 */
export function requestId() {
  return (req, res, next) => {
    const inbound = req.get('x-request-id');
    req.id = inbound && INBOUND_ID.test(inbound) ? inbound : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}
