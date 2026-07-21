import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { aiEstimations, exerciseEntries, foodEntries } from '../../db/schema.js';
import { AppError } from '../../errors/app-error.js';
import { invalidateUserReports } from '../../lib/cache.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';

export interface ListEntriesInput {
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface FoodEntryInput {
  clientEntryId?: string | undefined;
  entryDate: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  foodName: string;
  quantity: number;
  unit: string;
  calories: number;
  proteinG?: number | null | undefined;
  carbsG?: number | null | undefined;
  fatG?: number | null | undefined;
  aiEstimationId?: string | null | undefined;
}

export interface ExerciseEntryInput {
  clientEntryId?: string | undefined;
  entryDate: string;
  exerciseName: string;
  durationMinutes: number;
  intensity?: 'low' | 'moderate' | 'high' | null | undefined;
  caloriesBurned: number;
  notes?: string | null | undefined;
  aiEstimationId?: string | null | undefined;
}

async function sourceForEstimation(
  app: FastifyInstance,
  userId: string,
  estimationId: string | null | undefined,
  kind: 'food' | 'exercise',
): Promise<'manual' | 'ai'> {
  if (estimationId === undefined || estimationId === null) return 'manual';

  const [estimation] = await app.db
    .select({ id: aiEstimations.id })
    .from(aiEstimations)
    .where(
      and(
        eq(aiEstimations.id, estimationId),
        eq(aiEstimations.userId, userId),
        eq(aiEstimations.kind, kind),
      ),
    )
    .limit(1);

  if (estimation === undefined) {
    throw new AppError(
      422,
      'INVALID_AI_ESTIMATION',
      'The AI estimation does not exist or does not belong to this user.',
    );
  }

  return 'ai';
}

export async function createFoodEntry(
  app: FastifyInstance,
  userId: string,
  input: FoodEntryInput & { clientEntryId: string },
) {
  const source = await sourceForEstimation(app, userId, input.aiEstimationId, 'food');
  const inserted = await app.db
    .insert(foodEntries)
    .values({
      userId,
      clientEntryId: input.clientEntryId,
      entryDate: input.entryDate,
      mealType: input.mealType,
      foodName: input.foodName,
      quantity: input.quantity.toString(),
      unit: input.unit,
      calories: input.calories.toString(),
      proteinG: toNullableNumeric(input.proteinG),
      carbsG: toNullableNumeric(input.carbsG),
      fatG: toNullableNumeric(input.fatG),
      source,
      aiEstimationId: input.aiEstimationId ?? null,
    })
    .onConflictDoNothing({ target: [foodEntries.userId, foodEntries.clientEntryId] })
    .returning();

  const created = inserted[0];
  if (created !== undefined) {
    await invalidateUserReports(app, userId);
    return { entry: serializeFoodEntry(created), created: true };
  }

  const [existing] = await app.db
    .select()
    .from(foodEntries)
    .where(and(eq(foodEntries.userId, userId), eq(foodEntries.clientEntryId, input.clientEntryId)))
    .limit(1);
  return { entry: serializeFoodEntry(existing!), created: false };
}

export async function listFoodEntries(
  app: FastifyInstance,
  userId: string,
  input: ListEntriesInput,
) {
  const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const conditions = [eq(foodEntries.userId, userId)];
  if (input.from !== undefined) conditions.push(gte(foodEntries.entryDate, input.from));
  if (input.to !== undefined) conditions.push(lte(foodEntries.entryDate, input.to));
  if (cursor !== undefined) {
    conditions.push(
      or(
        lt(foodEntries.createdAt, new Date(cursor.createdAt)),
        and(eq(foodEntries.createdAt, new Date(cursor.createdAt)), lt(foodEntries.id, cursor.id)),
      )!,
    );
  }

  const records = await app.db
    .select()
    .from(foodEntries)
    .where(and(...conditions))
    .orderBy(desc(foodEntries.createdAt), desc(foodEntries.id))
    .limit(input.limit + 1);

  const hasMore = records.length > input.limit;
  const items = records.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items: items.map(serializeFoodEntry),
    nextCursor:
      hasMore && last !== undefined
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function getFoodEntry(app: FastifyInstance, userId: string, entryId: string) {
  const [entry] = await app.db
    .select()
    .from(foodEntries)
    .where(and(eq(foodEntries.id, entryId), eq(foodEntries.userId, userId)))
    .limit(1);
  if (entry === undefined) throw new AppError(404, 'FOOD_ENTRY_NOT_FOUND', 'Food entry not found.');
  return serializeFoodEntry(entry);
}

export async function updateFoodEntry(
  app: FastifyInstance,
  userId: string,
  entryId: string,
  input: FoodEntryInput,
) {
  const source = await sourceForEstimation(app, userId, input.aiEstimationId, 'food');
  const [entry] = await app.db
    .update(foodEntries)
    .set({
      entryDate: input.entryDate,
      mealType: input.mealType,
      foodName: input.foodName,
      quantity: input.quantity.toString(),
      unit: input.unit,
      calories: input.calories.toString(),
      proteinG: toNullableNumeric(input.proteinG),
      carbsG: toNullableNumeric(input.carbsG),
      fatG: toNullableNumeric(input.fatG),
      source,
      aiEstimationId: input.aiEstimationId ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(foodEntries.id, entryId), eq(foodEntries.userId, userId)))
    .returning();
  if (entry === undefined) throw new AppError(404, 'FOOD_ENTRY_NOT_FOUND', 'Food entry not found.');
  await invalidateUserReports(app, userId);
  return serializeFoodEntry(entry);
}

export async function deleteFoodEntry(
  app: FastifyInstance,
  userId: string,
  entryId: string,
): Promise<void> {
  const deleted = await app.db
    .delete(foodEntries)
    .where(and(eq(foodEntries.id, entryId), eq(foodEntries.userId, userId)))
    .returning({ id: foodEntries.id });
  if (deleted.length === 0)
    throw new AppError(404, 'FOOD_ENTRY_NOT_FOUND', 'Food entry not found.');
  await invalidateUserReports(app, userId);
}

export async function createExerciseEntry(
  app: FastifyInstance,
  userId: string,
  input: ExerciseEntryInput & { clientEntryId: string },
) {
  const source = await sourceForEstimation(app, userId, input.aiEstimationId, 'exercise');
  const inserted = await app.db
    .insert(exerciseEntries)
    .values({
      userId,
      clientEntryId: input.clientEntryId,
      entryDate: input.entryDate,
      exerciseName: input.exerciseName,
      durationMinutes: input.durationMinutes,
      intensity: input.intensity ?? null,
      caloriesBurned: input.caloriesBurned.toString(),
      notes: input.notes ?? null,
      source,
      aiEstimationId: input.aiEstimationId ?? null,
    })
    .onConflictDoNothing({ target: [exerciseEntries.userId, exerciseEntries.clientEntryId] })
    .returning();

  const created = inserted[0];
  if (created !== undefined) {
    await invalidateUserReports(app, userId);
    return { entry: serializeExerciseEntry(created), created: true };
  }

  const [existing] = await app.db
    .select()
    .from(exerciseEntries)
    .where(
      and(
        eq(exerciseEntries.userId, userId),
        eq(exerciseEntries.clientEntryId, input.clientEntryId),
      ),
    )
    .limit(1);
  return { entry: serializeExerciseEntry(existing!), created: false };
}

export async function listExerciseEntries(
  app: FastifyInstance,
  userId: string,
  input: ListEntriesInput,
) {
  const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const conditions = [eq(exerciseEntries.userId, userId)];
  if (input.from !== undefined) conditions.push(gte(exerciseEntries.entryDate, input.from));
  if (input.to !== undefined) conditions.push(lte(exerciseEntries.entryDate, input.to));
  if (cursor !== undefined) {
    conditions.push(
      or(
        lt(exerciseEntries.createdAt, new Date(cursor.createdAt)),
        and(
          eq(exerciseEntries.createdAt, new Date(cursor.createdAt)),
          lt(exerciseEntries.id, cursor.id),
        ),
      )!,
    );
  }

  const records = await app.db
    .select()
    .from(exerciseEntries)
    .where(and(...conditions))
    .orderBy(desc(exerciseEntries.createdAt), desc(exerciseEntries.id))
    .limit(input.limit + 1);
  const hasMore = records.length > input.limit;
  const items = records.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items: items.map(serializeExerciseEntry),
    nextCursor:
      hasMore && last !== undefined
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function getExerciseEntry(app: FastifyInstance, userId: string, entryId: string) {
  const [entry] = await app.db
    .select()
    .from(exerciseEntries)
    .where(and(eq(exerciseEntries.id, entryId), eq(exerciseEntries.userId, userId)))
    .limit(1);
  if (entry === undefined)
    throw new AppError(404, 'EXERCISE_ENTRY_NOT_FOUND', 'Exercise entry not found.');
  return serializeExerciseEntry(entry);
}

export async function updateExerciseEntry(
  app: FastifyInstance,
  userId: string,
  entryId: string,
  input: ExerciseEntryInput,
) {
  const source = await sourceForEstimation(app, userId, input.aiEstimationId, 'exercise');
  const [entry] = await app.db
    .update(exerciseEntries)
    .set({
      entryDate: input.entryDate,
      exerciseName: input.exerciseName,
      durationMinutes: input.durationMinutes,
      intensity: input.intensity ?? null,
      caloriesBurned: input.caloriesBurned.toString(),
      notes: input.notes ?? null,
      source,
      aiEstimationId: input.aiEstimationId ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(exerciseEntries.id, entryId), eq(exerciseEntries.userId, userId)))
    .returning();
  if (entry === undefined)
    throw new AppError(404, 'EXERCISE_ENTRY_NOT_FOUND', 'Exercise entry not found.');
  await invalidateUserReports(app, userId);
  return serializeExerciseEntry(entry);
}

export async function deleteExerciseEntry(
  app: FastifyInstance,
  userId: string,
  entryId: string,
): Promise<void> {
  const deleted = await app.db
    .delete(exerciseEntries)
    .where(and(eq(exerciseEntries.id, entryId), eq(exerciseEntries.userId, userId)))
    .returning({ id: exerciseEntries.id });
  if (deleted.length === 0)
    throw new AppError(404, 'EXERCISE_ENTRY_NOT_FOUND', 'Exercise entry not found.');
  await invalidateUserReports(app, userId);
}

function toNullableNumeric(value: number | null | undefined): string | null {
  return value === undefined || value === null ? null : value.toString();
}

function serializeFoodEntry(entry: typeof foodEntries.$inferSelect) {
  return {
    id: entry.id,
    clientEntryId: entry.clientEntryId,
    entryDate: entry.entryDate,
    mealType: entry.mealType,
    foodName: entry.foodName,
    quantity: Number(entry.quantity),
    unit: entry.unit,
    calories: Number(entry.calories),
    proteinG: entry.proteinG === null ? null : Number(entry.proteinG),
    carbsG: entry.carbsG === null ? null : Number(entry.carbsG),
    fatG: entry.fatG === null ? null : Number(entry.fatG),
    source: entry.source,
    aiEstimationId: entry.aiEstimationId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function serializeExerciseEntry(entry: typeof exerciseEntries.$inferSelect) {
  return {
    id: entry.id,
    clientEntryId: entry.clientEntryId,
    entryDate: entry.entryDate,
    exerciseName: entry.exerciseName,
    durationMinutes: entry.durationMinutes,
    intensity: entry.intensity,
    caloriesBurned: Number(entry.caloriesBurned),
    notes: entry.notes,
    source: entry.source,
    aiEstimationId: entry.aiEstimationId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}
