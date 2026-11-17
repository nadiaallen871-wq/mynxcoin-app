import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { REDACT_PATHS } from '../../src/config/logger.js';
import { scrub } from '../../src/modules/audit/audit.service.js';

function capture() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, logger: pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream) };
}

describe('log redaction', () => {
  it('never writes credentials, tokens or card data', () => {
    const { lines, logger } = capture();
    logger.info({
      req: { headers: { authorization: 'Bearer abc', cookie: 'sid=secret-cookie' } },
      body: { password: 'hunter2', token: 'tok_123', cardNumber: '4111111111111111', cvv: '123' },
    });
    const out = lines.join('');
    for (const secret of ['Bearer abc', 'secret-cookie', 'hunter2', 'tok_123', '4111111111111111', '"123"']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[REDACTED]');
  });
});

describe('audit scrub', () => {
  it('redacts sensitive keys recursively and stringifies bigints', () => {
    expect(scrub({ email: 'a@b.c', password: 'x', nested: { totpSecret: 'y', amountMinor: 10n } })).toEqual({
      email: 'a@b.c',
      password: '[REDACTED]',
      nested: { totpSecret: '[REDACTED]', amountMinor: '10' },
    });
  });
});
