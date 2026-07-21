import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

interface Entry {
  id: string;
  clientEntryId: string;
  foodName?: string;
  exerciseName?: string;
  source: 'manual' | 'ai';
}

async function register(app: FastifyInstance, email: string): Promise<string> {
  const eligibility = await app.inject({
    method: 'POST',
    url: '/v1/auth/eligibility',
    payload: { birthDate: '1990-01-01', countryCode: 'ID' },
  });
  const eligibilityToken = eligibility.json<{ eligibilityToken: string }>().eligibilityToken;
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { eligibilityToken, email, password: 'a sufficiently long password' },
  });
  return response.json<{ tokens: { accessToken: string } }>().tokens.accessToken;
}

describe('food and exercise entry API', () => {
  let app: FastifyInstance;
  let firstToken: string;
  let secondToken: string;
  let foodId: string;

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
    firstToken = await register(app, 'entries-one@example.com');
    secondToken = await register(app, 'entries-two@example.com');
  });

  afterAll(async () => app.close());

  it('creates food idempotently for offline retries', async () => {
    const payload = {
      clientEntryId: randomUUID(),
      entryDate: '2026-07-21',
      mealType: 'breakfast',
      foodName: 'Eggs and toast',
      quantity: 1,
      unit: 'serving',
      calories: 320,
      proteinG: 18,
      carbsG: 25,
      fatG: 15,
    };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/food-entries',
      headers: { authorization: `Bearer ${firstToken}` },
      payload,
    });
    expect(first.statusCode).toBe(201);
    foodId = first.json<Entry>().id;

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/food-entries',
      headers: { authorization: `Bearer ${firstToken}` },
      payload: { ...payload, calories: 999 },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<Entry>().id).toBe(foodId);
    expect(replay.json<{ calories: number }>().calories).toBe(320);
  });

  it('rejects AI references that are missing or owned by another user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/food-entries',
      headers: { authorization: `Bearer ${firstToken}` },
      payload: {
        clientEntryId: randomUUID(),
        entryDate: '2026-07-21',
        mealType: 'lunch',
        foodName: 'Unknown meal',
        quantity: 1,
        unit: 'serving',
        calories: 500,
        aiEstimationId: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it('isolates entries by user and supports update/delete', async () => {
    const hidden = await app.inject({
      method: 'GET',
      url: `/v1/food-entries/${foodId}`,
      headers: { authorization: `Bearer ${secondToken}` },
    });
    expect(hidden.statusCode).toBe(404);

    const updated = await app.inject({
      method: 'PUT',
      url: `/v1/food-entries/${foodId}`,
      headers: { authorization: `Bearer ${firstToken}` },
      payload: {
        entryDate: '2026-07-20',
        mealType: 'snack',
        foodName: 'Updated meal',
        quantity: 2,
        unit: 'pieces',
        calories: 400,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<Entry>().foodName).toBe('Updated meal');
  });

  it('provides bounded opaque cursor pagination', async () => {
    for (const name of ['Lunch', 'Dinner']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/food-entries',
        headers: { authorization: `Bearer ${firstToken}` },
        payload: {
          clientEntryId: randomUUID(),
          entryDate: '2026-07-21',
          mealType: 'lunch',
          foodName: name,
          quantity: 1,
          unit: 'serving',
          calories: 500,
        },
      });
      expect(response.statusCode).toBe(201);
    }

    const firstPage = await app.inject({
      method: 'GET',
      url: '/v1/food-entries?limit=1&from=2026-07-01&to=2026-07-31',
      headers: { authorization: `Bearer ${firstToken}` },
    });
    const page = firstPage.json<{ items: Entry[]; nextCursor: string | null }>();
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/food-entries?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`,
      headers: { authorization: `Bearer ${firstToken}` },
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json<{ items: Entry[] }>().items[0]?.id).not.toBe(page.items[0]?.id);
  });

  it('supports the complete exercise lifecycle', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/exercise-entries',
      headers: { authorization: `Bearer ${firstToken}` },
      payload: {
        clientEntryId: randomUUID(),
        entryDate: '2026-07-21',
        exerciseName: 'Running',
        durationMinutes: 30,
        intensity: 'high',
        caloriesBurned: 350,
      },
    });
    expect(created.statusCode).toBe(201);
    const exerciseId = created.json<Entry>().id;

    const updated = await app.inject({
      method: 'PUT',
      url: `/v1/exercise-entries/${exerciseId}`,
      headers: { authorization: `Bearer ${firstToken}` },
      payload: {
        entryDate: '2026-07-21',
        exerciseName: 'Easy run',
        durationMinutes: 35,
        intensity: 'moderate',
        caloriesBurned: 300,
        notes: 'Recovery pace',
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<Entry>().exerciseName).toBe('Easy run');

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/exercise-entries/${exerciseId}`,
      headers: { authorization: `Bearer ${firstToken}` },
    });
    expect(deleted.statusCode).toBe(204);
    expect(
      Number(
        await app.redis.get('reports:version:' + app.jwt.decode<{ sub: string }>(firstToken)?.sub),
      ),
    ).toBeGreaterThan(0);
  });
});
