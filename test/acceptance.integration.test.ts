import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('backend acceptance journey', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL,
        JWT_SECRET: 'acceptance-jwt-secret-at-least-thirty-two-characters',
        TOKEN_HASH_SECRET: 'acceptance-hash-secret-at-least-thirty-two-characters',
      }),
    });
    await app.pg.query('delete from users');
    await app.redis.flushdb();
  });

  afterAll(async () => app.close());

  it('registers, configures, tracks, reports, and deletes an account', async () => {
    const eligibility = await app.inject({
      method: 'POST',
      url: '/v1/auth/eligibility',
      payload: { birthDate: '2000-06-15', countryCode: 'ID' },
    });
    const eligibilityToken = eligibility.json<{ eligibilityToken: string }>().eligibilityToken;
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        eligibilityToken,
        email: 'acceptance@example.com',
        password: 'a secure acceptance password',
      },
    });
    expect(registration.statusCode).toBe(201);
    const accessToken = registration.json<{ tokens: { accessToken: string } }>().tokens.accessToken;
    const headers = { authorization: `Bearer ${accessToken}` };

    const profile = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/profile',
      headers,
      payload: {
        gender: 'female',
        heightCm: 165,
        weightKg: 60,
        activityLevel: 'moderate',
        goalType: 'maintain',
        dailyCalorieGoal: 2_000,
      },
    });
    expect(profile.statusCode).toBe(200);

    const food = await app.inject({
      method: 'POST',
      url: '/v1/food-entries',
      headers,
      payload: {
        clientEntryId: randomUUID(),
        entryDate: '2026-07-21',
        mealType: 'lunch',
        foodName: 'Rice bowl',
        quantity: 1,
        unit: 'bowl',
        calories: 650,
        proteinG: 30,
        carbsG: 80,
        fatG: 20,
      },
    });
    const exercise = await app.inject({
      method: 'POST',
      url: '/v1/exercise-entries',
      headers,
      payload: {
        clientEntryId: randomUUID(),
        entryDate: '2026-07-21',
        exerciseName: 'Cycling',
        durationMinutes: 30,
        intensity: 'moderate',
        caloriesBurned: 200,
      },
    });
    expect(food.statusCode).toBe(201);
    expect(exercise.statusCode).toBe(201);

    const report = await app.inject({
      method: 'GET',
      url: '/v1/reports/summary?period=daily&anchor=2026-07-21',
      headers,
    });
    expect(report.statusCode).toBe(200);
    expect(
      report.json<{
        totals: { caloriesIn: number; caloriesOut: number; netCalories: number };
      }>().totals,
    ).toMatchObject({ caloriesIn: 650, caloriesOut: 200, netCalories: 450 });

    const deletion = await app.inject({
      method: 'DELETE',
      url: '/v1/users/me',
      headers,
    });
    expect(deletion.statusCode).toBe(204);
    const remaining = await app.pg.query<{ count: string }>('select count(*) from users');
    expect(remaining.rows[0]?.count).toBe('0');
  });
});
