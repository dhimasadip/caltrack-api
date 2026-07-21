import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('operational routes', () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  it('reports process health', async () => {
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      infrastructure: false,
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('uses the standard not-found error envelope', async () => {
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      infrastructure: false,
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
    const body = response.json<{
      error: { code: string; message: string; requestId: string };
    }>();
    expect(body).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
    expect(body.error.message).toBeTypeOf('string');
    expect(body.error.requestId).toBeTypeOf('string');
  });
});
