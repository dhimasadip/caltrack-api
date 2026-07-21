import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { userProfiles, users } from '../src/db/schema.js';

const maximumDurationMs = 2_000;
const app = await buildApp({
  config: loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    JWT_SECRET: 'performance-jwt-secret-at-least-thirty-two-characters',
    TOKEN_HASH_SECRET: 'performance-hash-secret-at-least-thirty-two-characters',
  }),
});
const userId = randomUUID();

try {
  await app.db.insert(users).values({
    id: userId,
    email: `performance-${userId}@example.com`,
    passwordHash: 'not-used-by-the-performance-test',
  });
  await app.db.insert(userProfiles).values({
    userId,
    birthDate: '1990-01-01',
    countryCode: 'ID',
    gender: 'other',
    heightCm: '170',
    weightKg: '70',
    activityLevel: 'moderate',
    goalType: 'maintain',
    dailyCalorieGoal: 2_200,
    suggestedCalorieGoal: 2_200,
    bmr: '1600',
    tdee: '2200',
    calculationMethod: 'mifflin_st_jeor',
    onboardingComplete: true,
  });

  await app.pg.query(
    `insert into food_entries
       (user_id, client_entry_id, entry_date, meal_type, food_name, quantity, unit,
        calories, protein_g, carbs_g, fat_g, source)
     select $1, gen_random_uuid(), day::date, 'lunch', 'Seed meal', 1, 'serving',
            350, 20, 40, 12, 'manual'
     from generate_series(date '2024-01-01', date '2024-12-31', interval '1 day') day
     cross join generate_series(1, 8) entry_number`,
    [userId],
  );
  await app.pg.query(
    `insert into exercise_entries
       (user_id, client_entry_id, entry_date, exercise_name, duration_minutes,
        intensity, calories_burned, source)
     select $1, gen_random_uuid(), day::date, 'Seed walk', 30, 'moderate', 140, 'manual'
     from generate_series(date '2024-01-01', date '2024-12-31', interval '1 day') day
     cross join generate_series(1, 4) entry_number`,
    [userId],
  );

  const accessToken = app.jwt.sign({ type: 'access', sub: userId }, { expiresIn: '15m' });
  const startedAt = performance.now();
  const response = await app.inject({
    method: 'GET',
    url: '/v1/reports/summary?period=custom&start=2024-01-01&end=2024-12-31',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const durationMs = performance.now() - startedAt;

  if (response.statusCode !== 200) {
    throw new Error(`Performance request failed: ${response.statusCode} ${response.body}`);
  }
  if (durationMs >= maximumDurationMs) {
    throw new Error(
      `Uncached 366-day report took ${durationMs.toFixed(1)}ms; target is under ${maximumDurationMs}ms.`,
    );
  }

  console.log(
    `Report performance passed: ${durationMs.toFixed(1)}ms for 4,392 seeded entries over 366 days.`,
  );
} finally {
  await app.pg.query('delete from users where id = $1', [userId]);
  await app.redis.del(`reports:version:${userId}`);
  await app.close();
}
