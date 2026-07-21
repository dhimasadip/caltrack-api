import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('HTTP production controls', () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  it('sets security headers and permits an allowlisted origin', async () => {
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: 'https://app.example.com' }),
      infrastructure: false,
    });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example.com' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('rejects a browser origin outside the allowlist', async () => {
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: 'https://app.example.com' }),
      infrastructure: false,
    });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://attacker.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('CORS_ORIGIN_DENIED');
  });

  it('uses a stricter per-IP limit on authentication routes', async () => {
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', AUTH_RATE_LIMIT_MAX: '1' }),
      infrastructure: false,
    });
    apps.push(app);
    const request = {
      method: 'POST' as const,
      url: '/v1/auth/eligibility',
      payload: { birthDate: '2000-01-01', countryCode: 'ID' },
    };
    expect((await app.inject(request)).statusCode).toBe(200);
    const rejected = await app.inject(request);
    expect(rejected.statusCode).toBe(429);
    expect(rejected.json<{ error: { code: string } }>().error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('returns the standard envelope for an oversized body', async () => {
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', BODY_LIMIT_BYTES: '1024' }),
      infrastructure: false,
    });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'user@example.com', password: 'x'.repeat(2_000) },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('requires non-development token secrets in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow();
  });
});
