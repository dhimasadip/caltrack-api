import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { userProfiles, users, type NotificationPreferences } from '../../db/schema.js';
import { AppError } from '../../errors/app-error.js';
import { ageOnDate } from '../../lib/date.js';
import {
  calculateCalories,
  type ActivityLevel,
  type Gender,
  type GoalType,
} from './calorie-calculator.js';

export interface UpdateProfileInput {
  gender: Gender;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goalType: GoalType;
  targetWeightKg?: number | null | undefined;
  targetDate?: string | null | undefined;
  dailyCalorieGoal?: number | undefined;
}

export interface UpdateSettingsInput {
  timeZone?: string | undefined;
  unitSystem?: 'metric' | 'imperial' | undefined;
  notificationPreferences?: NotificationPreferences | undefined;
}

export async function getCurrentUser(app: FastifyInstance, userId: string) {
  const [record] = await app.db
    .select({
      id: users.id,
      email: users.email,
      createdAt: users.createdAt,
      profile: userProfiles,
    })
    .from(users)
    .innerJoin(userProfiles, eq(users.id, userProfiles.userId))
    .where(eq(users.id, userId))
    .limit(1);

  if (record === undefined) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User was not found.');
  }

  const age = ageOnDate(record.profile.birthDate);
  return {
    id: record.id,
    email: record.email,
    createdAt: record.createdAt.toISOString(),
    ageBand: age < 18 ? ('teen' as const) : ('adult' as const),
    adPersonalizationAllowed: age >= 18,
    profile: serializeProfile(record.profile),
  };
}

export async function updateProfile(
  app: FastifyInstance,
  userId: string,
  input: UpdateProfileInput,
) {
  const [existing] = await app.db
    .select({ birthDate: userProfiles.birthDate })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  if (existing === undefined) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User was not found.');
  }

  const calculation = calculateCalories({
    age: ageOnDate(existing.birthDate),
    gender: input.gender,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    activityLevel: input.activityLevel,
    goalType: input.goalType,
  });

  const [updated] = await app.db
    .update(userProfiles)
    .set({
      gender: input.gender,
      heightCm: input.heightCm.toString(),
      weightKg: input.weightKg.toString(),
      activityLevel: input.activityLevel,
      goalType: input.goalType,
      targetWeightKg:
        input.targetWeightKg === undefined || input.targetWeightKg === null
          ? null
          : input.targetWeightKg.toString(),
      targetDate: input.targetDate ?? null,
      bmr: calculation.bmr?.toString() ?? null,
      tdee: calculation.tdee.toString(),
      suggestedCalorieGoal: calculation.suggestedDailyCalorieGoal,
      dailyCalorieGoal: input.dailyCalorieGoal ?? calculation.suggestedDailyCalorieGoal,
      calculationMethod: calculation.method,
      calculationAssumptions: calculation.assumptions,
      onboardingComplete: true,
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.userId, userId))
    .returning();

  await invalidateUserReports(app, userId);
  return serializeProfile(updated!);
}

export async function updateSettings(
  app: FastifyInstance,
  userId: string,
  input: UpdateSettingsInput,
) {
  const [updated] = await app.db
    .update(userProfiles)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(userProfiles.userId, userId))
    .returning();

  if (updated === undefined) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User was not found.');
  }

  return serializeProfile(updated);
}

export async function deleteCurrentUser(app: FastifyInstance, userId: string): Promise<void> {
  await app.db.delete(users).where(eq(users.id, userId));
  try {
    await app.redis.del(`reports:version:${userId}`, `ai:quota:${userId}`);
  } catch (error) {
    app.log.warn({ err: error, userId }, 'Failed to clear user cache after account deletion');
  }
}

async function invalidateUserReports(app: FastifyInstance, userId: string): Promise<void> {
  try {
    await app.redis.incr(`reports:version:${userId}`);
  } catch (error) {
    app.log.warn({ err: error, userId }, 'Failed to invalidate report cache');
  }
}

function serializeProfile(profile: typeof userProfiles.$inferSelect) {
  return {
    birthDate: profile.birthDate,
    countryCode: profile.countryCode,
    gender: profile.gender,
    heightCm: profile.heightCm === null ? null : Number(profile.heightCm),
    weightKg: profile.weightKg === null ? null : Number(profile.weightKg),
    activityLevel: profile.activityLevel,
    goalType: profile.goalType,
    targetWeightKg: profile.targetWeightKg === null ? null : Number(profile.targetWeightKg),
    targetDate: profile.targetDate,
    dailyCalorieGoal: profile.dailyCalorieGoal,
    suggestedCalorieGoal: profile.suggestedCalorieGoal,
    bmr: profile.bmr === null ? null : Number(profile.bmr),
    tdee: profile.tdee === null ? null : Number(profile.tdee),
    calculationMethod: profile.calculationMethod,
    calculationAssumptions: profile.calculationAssumptions,
    timeZone: profile.timeZone,
    unitSystem: profile.unitSystem,
    notificationPreferences: profile.notificationPreferences,
    onboardingComplete: profile.onboardingComplete,
    updatedAt: profile.updatedAt.toISOString(),
  };
}
