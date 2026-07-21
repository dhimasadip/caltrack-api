import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

interface Report {
  range: { period: string; start: string; end: string };
  totals: {
    days: number;
    caloriesIn: number;
    caloriesOut: number;
    netCalories: number;
    goalCalories: number;
    remainingCalories: number;
    proteinG: number;
  };
  series: { date: string; caloriesIn: number; caloriesOut: number }[];
}

describe('report API', () => {
  let app: FastifyInstance;
  let token: string;

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

    const eligibility = await app.inject({
      method: 'POST',
      url: '/v1/auth/eligibility',
      payload: { birthDate: '1990-01-01', countryCode: 'ID' },
    });
    const registered = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        eligibilityToken: eligibility.json<{ eligibilityToken: string }>().eligibilityToken,
        email: 'reports@example.com',
        password: 'a sufficiently long password',
      },
    });
    token = registered.json<{ tokens: { accessToken: string } }>().tokens.accessToken;

    await app.inject({
      method: 'PUT',
      url: '/v1/users/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        gender: 'male',
        heightCm: 175,
        weightKg: 75,
        activityLevel: 'moderate',
        goalType: 'maintain',
        dailyCalorieGoal: 2_000,
      },
    });
    await createFood(700, 40);
    await createExercise(200);
  });

  afterAll(async () => app.close());

  async function createFood(calories: number, proteinG = 0): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/food-entries',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        clientEntryId: randomUUID(),
        entryDate: '2026-07-21',
        mealType: 'lunch',
        foodName: 'Meal',
        quantity: 1,
        unit: 'serving',
        calories,
        proteinG,
      },
    });
    expect(response.statusCode).toBe(201);
  }

  async function createExercise(caloriesBurned: number): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/exercise-entries',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        clientEntryId: randomUUID(),
        entryDate: '2026-07-21',
        exerciseName: 'Walk',
        durationMinutes: 60,
        caloriesBurned,
      },
    });
    expect(response.statusCode).toBe(201);
  }

  it('calculates daily dashboard totals and macros', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/reports/summary?period=daily&anchor=2026-07-21',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const report = response.json<Report>();
    expect(report.totals).toMatchObject({
      days: 1,
      caloriesIn: 700,
      caloriesOut: 200,
      netCalories: 500,
      goalCalories: 2_000,
      remainingCalories: 1_500,
      proteinG: 40,
    });
  });

  it('uses ISO Monday-Sunday weekly boundaries and includes empty days', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/reports/summary?period=weekly&anchor=2026-07-21',
      headers: { authorization: `Bearer ${token}` },
    });
    const report = response.json<Report>();
    expect(report.range).toEqual({ period: 'weekly', start: '2026-07-20', end: '2026-07-26' });
    expect(report.series).toHaveLength(7);
    expect(report.totals.goalCalories).toBe(14_000);
  });

  it('returns the complete calendar month', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/reports/summary?period=monthly&anchor=2026-07-21',
      headers: { authorization: `Bearer ${token}` },
    });
    const report = response.json<Report>();
    expect(report.range.start).toBe('2026-07-01');
    expect(report.range.end).toBe('2026-07-31');
    expect(report.series).toHaveLength(31);
  });

  it('rejects reversed and oversized custom ranges', async () => {
    const reversed = await app.inject({
      method: 'GET',
      url: '/v1/reports/summary?period=custom&start=2026-08-01&end=2026-07-01',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(reversed.statusCode).toBe(400);

    const oversized = await app.inject({
      method: 'GET',
      url: '/v1/reports/summary?period=custom&start=2024-01-01&end=2026-01-01',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(oversized.statusCode).toBe(400);
  });

  it('invalidates cached reports after an entry mutation', async () => {
    await createFood(300, 10);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/reports/summary?period=daily&anchor=2026-07-21',
      headers: { authorization: `Bearer ${token}` },
    });
    const report = response.json<Report>();
    expect(report.totals.caloriesIn).toBe(1_000);
    expect(report.totals.netCalories).toBe(800);
    expect(report.totals.proteinG).toBe(50);
  });

  it('returns zero values for a day without entries', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/reports/summary?period=daily&anchor=2026-07-22',
      headers: { authorization: `Bearer ${token}` },
    });
    const report = response.json<Report>();
    expect(report.totals.caloriesIn).toBe(0);
    expect(report.totals.caloriesOut).toBe(0);
    expect(report.totals.remainingCalories).toBe(2_000);
  });
});
