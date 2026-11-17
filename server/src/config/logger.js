import pino from 'pino';

/**
 * Paths that must never be written to logs. Pino replaces them with "[REDACTED]".
 * Keep this list in sync with documentation/security.md.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-paystack-signature"]',
  'req.headers["verif-hash"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.totpSecret',
  '*.recoveryCodes',
  '*.otp',
  '*.cardNumber',
  '*.cvv',
  '*.idNumber',
  '*.documentData',
  'password',
  'token',
  'secret',
];

export function createLogger({ level = 'info', pretty = false } = {}) {
  return pino({
    level,
    base: { service: 'mynx-api' },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}
