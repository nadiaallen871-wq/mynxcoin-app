import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SESSION_SECRET: 'x'.repeat(40),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('environment validation', () => {
  it('applies safe defaults: sandbox mode', () => {
    const env = loadEnv(base);
    expect(env.PLATFORM_MODE).toBe('sandbox');
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('parses the CORS allowlist', () => {
    expect(loadEnv({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test' }).CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects wildcard CORS origins', () => {
    expect(() => loadEnv({ ...base, CORS_ORIGINS: '*' })).toThrow(/Wildcard/);
  });

  it('rejects live mode outside production', () => {
    expect(() => loadEnv({ ...base, PLATFORM_MODE: 'live', NODE_ENV: 'staging' })).toThrow(/Live mode/);
  });

  it('rejects short secrets, default secrets in production, and http origins in production', () => {
    expect(() => loadEnv({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', SESSION_SECRET: `change-me-${'x'.repeat(40)}` })).toThrow(/Default secret/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'http://app.example' })).toThrow(/https/);
  });

  it('requires a database URL', () => {
    expect(() => loadEnv({ SESSION_SECRET: base.SESSION_SECRET })).toThrow(/DATABASE_URL/);
  });
});
