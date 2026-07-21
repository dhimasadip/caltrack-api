import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('published API documentation', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      infrastructure: false,
    });
  });

  afterAll(async () => app.close());

  it('publishes versioned routes, security, summaries, and examples', async () => {
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    const document = response.json<{
      info: { version: string };
      paths: Record<string, Record<string, { summary?: string }>>;
      components: { securitySchemes: Record<string, unknown>; examples: Record<string, unknown> };
    }>();
    expect(document.info.version).toBe('1.0.0');
    expect(document.paths['/v1/auth/register']?.post?.summary).toBeTypeOf('string');
    expect(document.paths['/v1/reports/summary']?.get?.summary).toBeTypeOf('string');
    expect(document.paths['/v1/food-entries/ai-estimate']?.post?.summary).toBeTypeOf('string');
    expect(document.components.securitySchemes.bearerAuth).toBeDefined();
    expect(document.components.examples.standardError).toBeDefined();
  });

  it('serves Swagger UI with security headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
