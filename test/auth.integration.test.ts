import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

interface AuthResponse {
  userId: string;
  profileComplete: boolean;
  tokens: { accessToken: string; refreshToken: string };
}

describe('authentication and profile API', () => {
  let app: FastifyInstance;
  let auth: AuthResponse;

  beforeAll(async () => {
    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL,
        JWT_SECRET: 'test-jwt-secret-with-at-least-thirty-two-characters',
        TOKEN_HASH_SECRET: 'test-hash-secret-with-at-least-thirty-two-characters',
      }),
    });
    await app.pg.query('delete from users');
    await app.redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a user below the age gate', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/eligibility',
      payload: { birthDate: '2015-01-01', countryCode: 'ID' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AGE_RESTRICTED');
  });

  it('registers an eligible user and rejects a duplicate email', async () => {
    const eligibility = await app.inject({
      method: 'POST',
      url: '/v1/auth/eligibility',
      payload: { birthDate: '2000-01-01', countryCode: 'id' },
    });
    const eligibilityToken = eligibility.json<{ eligibilityToken: string }>().eligibilityToken;

    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        eligibilityToken,
        email: 'User@Example.com',
        password: 'a sufficiently long password',
      },
    });

    expect(registration.statusCode).toBe(201);
    auth = registration.json<AuthResponse>();
    expect(auth.profileComplete).toBe(false);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        eligibilityToken,
        email: 'user@example.com',
        password: 'a different long password',
      },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('rejects tampered eligibility tokens', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        eligibilityToken: 'not-a-token',
        email: 'other@example.com',
        password: 'a sufficiently long password',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('logs in with a normalized email and rejects a wrong password', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'USER@example.com', password: 'a sufficiently long password' },
    });
    expect(login.statusCode).toBe(200);

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'user@example.com', password: 'wrong' },
    });
    expect(rejected.statusCode).toBe(401);
  });

  it('completes a profile and returns calculation metadata', async () => {
    const update = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/profile',
      headers: { authorization: `Bearer ${auth.tokens.accessToken}` },
      payload: {
        gender: 'other',
        heightCm: 170,
        weightKg: 70,
        activityLevel: 'moderate',
        goalType: 'lose',
      },
    });

    expect(update.statusCode).toBe(200);
    expect(update.json<{ calculationMethod: string }>().calculationMethod).toBe('mifflin_st_jeor');

    const current = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${auth.tokens.accessToken}` },
    });
    expect(current.statusCode).toBe(200);
    expect(
      current.json<{ profile: { onboardingComplete: boolean } }>().profile.onboardingComplete,
    ).toBe(true);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const rotated = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: auth.tokens.refreshToken },
    });
    expect(rotated.statusCode).toBe(200);

    const reused = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: auth.tokens.refreshToken },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json<{ error: { code: string } }>().error.code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('updates validated user settings', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/settings',
      headers: { authorization: `Bearer ${auth.tokens.accessToken}` },
      payload: { timeZone: 'Asia/Jakarta', unitSystem: 'metric' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ timeZone: string }>().timeZone).toBe('Asia/Jakarta');
  });

  it('deletes the account and all authentication data', async () => {
    await app.redis.mset(
      `reports:version:${auth.userId}`,
      '2',
      `reports:data:${auth.userId}:2:daily:2026-07-21:2026-07-21`,
      '{}',
      `ai:quota:${auth.userId}:2026-07-21`,
      '3',
      `ai:lock:${auth.userId}:2f128a3e-c90d-452f-a653-9671969736d4`,
      '1',
    );
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${auth.tokens.accessToken}` },
    });
    expect(response.statusCode).toBe(204);

    const result = await app.pg.query<{ count: string }>('select count(*) from users');
    expect(result.rows[0]?.count).toBe('0');
    expect(await app.redis.keys(`*${auth.userId}*`)).toEqual([]);
  });
});
