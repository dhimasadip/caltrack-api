import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { userProfiles } from '../../db/schema.js';
import { AppError } from '../../errors/app-error.js';
import { addUtcDays, formatIsoDate, inclusiveDayCount, parseIsoDate } from '../../lib/date.js';
import { reportResponseSchema, type ReportPeriod, type ReportResponse } from './report-contract.js';

interface ReportInput {
  period: ReportPeriod;
  anchor?: string | undefined;
  start?: string | undefined;
  end?: string | undefined;
}

interface AggregatedDayRow {
  date: string;
  calories_in: string;
  calories_out: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
}

interface ResolvedRange {
  start: string;
  end: string;
}

export async function getReport(
  app: FastifyInstance,
  userId: string,
  input: ReportInput,
): Promise<ReportResponse> {
  const range = resolveRange(input);
  const [profile] = await app.db
    .select({ dailyCalorieGoal: userProfiles.dailyCalorieGoal })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  if (profile?.dailyCalorieGoal === null || profile?.dailyCalorieGoal === undefined) {
    throw new AppError(409, 'PROFILE_INCOMPLETE', 'Complete your profile before viewing reports.');
  }

  const cacheKey = await buildCacheKey(app, userId, input.period, range);
  const cached = await getCachedReport(app, cacheKey);
  if (cached !== null) return cached;

  const result = await app.pg.query<AggregatedDayRow>(
    `with days as (
       select generate_series($2::date, $3::date, interval '1 day')::date as day
     ), food as (
       select entry_date,
              sum(calories) as calories_in,
              sum(coalesce(protein_g, 0)) as protein_g,
              sum(coalesce(carbs_g, 0)) as carbs_g,
              sum(coalesce(fat_g, 0)) as fat_g
       from food_entries
       where user_id = $1 and entry_date between $2::date and $3::date
       group by entry_date
     ), exercise as (
       select entry_date, sum(calories_burned) as calories_out
       from exercise_entries
       where user_id = $1 and entry_date between $2::date and $3::date
       group by entry_date
     )
     select to_char(days.day, 'YYYY-MM-DD') as date,
            coalesce(food.calories_in, 0)::text as calories_in,
            coalesce(exercise.calories_out, 0)::text as calories_out,
            coalesce(food.protein_g, 0)::text as protein_g,
            coalesce(food.carbs_g, 0)::text as carbs_g,
            coalesce(food.fat_g, 0)::text as fat_g
     from days
     left join food on food.entry_date = days.day
     left join exercise on exercise.entry_date = days.day
     order by days.day`,
    [userId, range.start, range.end],
  );

  const dailyGoal = profile.dailyCalorieGoal;
  const series = result.rows.map((row) => {
    const caloriesIn = Number(row.calories_in);
    const caloriesOut = Number(row.calories_out);
    const netCalories = caloriesIn - caloriesOut;
    return {
      date: row.date,
      caloriesIn,
      caloriesOut,
      netCalories,
      goalCalories: dailyGoal,
      remainingCalories: dailyGoal - netCalories,
      proteinG: Number(row.protein_g),
      carbsG: Number(row.carbs_g),
      fatG: Number(row.fat_g),
    };
  });

  const totals = series.reduce(
    (sum, day) => ({
      days: sum.days + 1,
      caloriesIn: sum.caloriesIn + day.caloriesIn,
      caloriesOut: sum.caloriesOut + day.caloriesOut,
      netCalories: sum.netCalories + day.netCalories,
      goalCalories: sum.goalCalories + day.goalCalories,
      remainingCalories: sum.remainingCalories + day.remainingCalories,
      proteinG: sum.proteinG + day.proteinG,
      carbsG: sum.carbsG + day.carbsG,
      fatG: sum.fatG + day.fatG,
    }),
    {
      days: 0,
      caloriesIn: 0,
      caloriesOut: 0,
      netCalories: 0,
      goalCalories: 0,
      remainingCalories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    },
  );

  const report: ReportResponse = {
    range: { period: input.period, ...range },
    totals,
    series,
  };
  await cacheReport(app, cacheKey, report);
  return report;
}

function resolveRange(input: ReportInput): ResolvedRange {
  if (input.period === 'custom') {
    if (input.start === undefined || input.end === undefined) {
      throw new AppError(400, 'INVALID_REPORT_RANGE', 'Custom reports require start and end.');
    }
    const start = parseIsoDate(input.start)!;
    const end = parseIsoDate(input.end)!;
    const days = inclusiveDayCount(start, end);
    if (days < 1 || days > 366) {
      throw new AppError(400, 'INVALID_REPORT_RANGE', 'Custom report range must be 1–366 days.');
    }
    return { start: input.start, end: input.end };
  }

  const anchor = parseIsoDate(input.anchor!)!;
  if (input.period === 'daily') {
    return { start: input.anchor!, end: input.anchor! };
  }
  if (input.period === 'weekly') {
    const day = anchor.getUTCDay();
    const monday = addUtcDays(anchor, -(day === 0 ? 6 : day - 1));
    return { start: formatIsoDate(monday), end: formatIsoDate(addUtcDays(monday, 6)) };
  }
  const monthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  return { start: formatIsoDate(monthStart), end: formatIsoDate(monthEnd) };
}

async function buildCacheKey(
  app: FastifyInstance,
  userId: string,
  period: ReportPeriod,
  range: ResolvedRange,
): Promise<string> {
  let version = '0';
  try {
    version = (await app.redis.get(`reports:version:${userId}`)) ?? '0';
  } catch (error) {
    app.log.warn({ err: error, userId }, 'Failed to read report cache version');
  }
  return `reports:data:${userId}:${version}:${period}:${range.start}:${range.end}`;
}

async function getCachedReport(app: FastifyInstance, key: string): Promise<ReportResponse | null> {
  try {
    const value = await app.redis.get(key);
    if (value === null) return null;
    const parsed = reportResponseSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    app.log.warn({ err: error }, 'Failed to read report cache');
    return null;
  }
}

async function cacheReport(
  app: FastifyInstance,
  key: string,
  report: ReportResponse,
): Promise<void> {
  try {
    await app.redis.set(key, JSON.stringify(report), 'EX', app.config.REPORT_CACHE_TTL_SECONDS);
  } catch (error) {
    app.log.warn({ err: error }, 'Failed to cache report');
  }
}
