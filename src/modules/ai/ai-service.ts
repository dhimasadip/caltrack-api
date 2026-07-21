import { createHmac } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { aiEstimations, userProfiles } from '../../db/schema.js';
import { AppError } from '../../errors/app-error.js';
import {
  AIProviderError,
  type AIProviderResult,
  exerciseEstimateSchema,
  foodEstimateSchema,
} from './ai-provider.js';

const RESERVE_QUOTA_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if current >= limit then return -1 end
current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
return current
`;

const RELEASE_QUOTA_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 1 then redis.call('DEL', KEYS[1]); return 0 end
return redis.call('DECR', KEYS[1])
`;

const quotaKeyTtlSeconds = 3 * 24 * 60 * 60;
const foodCacheSchema = z.object({
  result: foodEstimateSchema,
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});
const exerciseCacheSchema = z.object({
  result: exerciseEstimateSchema,
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});

export interface EstimateInput {
  requestKey: string;
  description: string;
}

interface UserAIContext {
  timeZone: string;
  weightKg: number | null;
}

interface StoredEstimate {
  id: string;
  kind: 'food' | 'exercise';
  result: Record<string, unknown>;
  confidence: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cached: boolean;
}

export function localDateAt(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function calculateExerciseCalories(
  metValue: number,
  weightKg: number,
  durationMinutes: number,
): number {
  return Math.round(((metValue * 3.5 * weightKg) / 200) * durationMinutes * 100) / 100;
}

export async function getAIQuota(app: FastifyInstance, userId: string) {
  const context = await getUserContext(app, userId);
  const localDate = localDateAt(new Date(), context.timeZone);
  const key = quotaKey(userId, localDate);

  try {
    const used = Number((await app.redis.get(key)) ?? '0');
    return {
      localDate,
      timeZone: context.timeZone,
      limit: app.config.AI_DAILY_QUOTA,
      used,
      remaining: Math.max(0, app.config.AI_DAILY_QUOTA - used),
    };
  } catch {
    throw quotaUnavailableError();
  }
}

export async function estimateFood(app: FastifyInstance, userId: string, input: EstimateInput) {
  return withRequestLock(app, userId, input.requestKey, async () => {
    const replay = await findReplay(app, userId, input.requestKey, 'food');
    if (replay !== undefined) return serializeFoodEstimate(replay, false);

    const context = await getUserContext(app, userId);
    const inputHash = hashInput(app, `food:${normalizeDescription(input.description)}`);
    const quotaReservation = await reserveQuota(app, userId, context.timeZone);

    try {
      const cacheKey = `ai:cache:food:${inputHash}`;
      const cached = await readCache(app, cacheKey, foodCacheSchema);
      const providerResult =
        cached ??
        (await app.aiProvider.estimateFood({
          description: input.description,
          safetyIdentifier: safetyIdentifier(app, userId),
        }));
      if (cached === null) await writeCache(app, cacheKey, providerResult);

      const stored = await persistEstimate(app, {
        userId,
        requestKey: input.requestKey,
        kind: 'food',
        inputHash,
        providerResult,
        cached: cached !== null,
      });
      return serializeFoodEstimate(stored, true);
    } catch (error) {
      await releaseQuota(app, quotaReservation.key);
      throw mapProviderError(error);
    }
  });
}

export async function estimateExercise(app: FastifyInstance, userId: string, input: EstimateInput) {
  return withRequestLock(app, userId, input.requestKey, async () => {
    const replay = await findReplay(app, userId, input.requestKey, 'exercise');
    if (replay !== undefined) return serializeExerciseEstimate(replay, false);

    const context = await getUserContext(app, userId);
    if (context.weightKg === null) {
      throw new AppError(
        422,
        'PROFILE_WEIGHT_REQUIRED',
        'A profile weight is required for exercise estimation.',
      );
    }

    const normalized = normalizeDescription(input.description);
    const inputHash = hashInput(app, `exercise:${normalized}:weightKg=${context.weightKg}`);
    const quotaReservation = await reserveQuota(app, userId, context.timeZone);

    try {
      const cacheKey = `ai:cache:exercise:${inputHash}`;
      const cached = await readCache(app, cacheKey, exerciseCacheSchema);
      const providerResult =
        cached ??
        (await app.aiProvider.estimateExercise({
          description: input.description,
          safetyIdentifier: safetyIdentifier(app, userId),
        }));
      if (cached === null) await writeCache(app, cacheKey, providerResult);

      const result = {
        ...providerResult.result,
        caloriesBurned: calculateExerciseCalories(
          providerResult.result.metValue,
          context.weightKg,
          providerResult.result.durationMinutes,
        ),
      };
      const stored = await persistEstimate(app, {
        userId,
        requestKey: input.requestKey,
        kind: 'exercise',
        inputHash,
        providerResult: { ...providerResult, result },
        cached: cached !== null,
      });
      return serializeExerciseEstimate(stored, true);
    } catch (error) {
      await releaseQuota(app, quotaReservation.key);
      throw mapProviderError(error);
    }
  });
}

async function getUserContext(app: FastifyInstance, userId: string): Promise<UserAIContext> {
  const [profile] = await app.db
    .select({ timeZone: userProfiles.timeZone, weightKg: userProfiles.weightKg })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  if (profile === undefined) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  return {
    timeZone: profile.timeZone,
    weightKg: profile.weightKg === null ? null : Number(profile.weightKg),
  };
}

async function findReplay(
  app: FastifyInstance,
  userId: string,
  requestKey: string,
  expectedKind: 'food' | 'exercise',
): Promise<StoredEstimate | undefined> {
  const [existing] = await app.db
    .select()
    .from(aiEstimations)
    .where(and(eq(aiEstimations.userId, userId), eq(aiEstimations.requestKey, requestKey)))
    .limit(1);
  if (existing !== undefined && existing.kind !== expectedKind) {
    throw new AppError(
      409,
      'AI_REQUEST_KEY_REUSED',
      'The request key was already used for another estimation type.',
    );
  }
  return existing;
}

async function withRequestLock<T>(
  app: FastifyInstance,
  userId: string,
  requestKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockKey = `ai:lock:${userId}:${requestKey}`;
  let acquired: string | null;
  try {
    acquired = await app.redis.set(lockKey, '1', 'EX', 60, 'NX');
  } catch {
    throw quotaUnavailableError();
  }
  if (acquired === null) {
    throw new AppError(409, 'AI_ESTIMATION_IN_PROGRESS', 'This estimation is already in progress.');
  }

  try {
    return await operation();
  } finally {
    try {
      await app.redis.del(lockKey);
    } catch {
      // The lock expires automatically; failure here must not mask the operation result.
    }
  }
}

async function reserveQuota(app: FastifyInstance, userId: string, timeZone: string) {
  const localDate = localDateAt(new Date(), timeZone);
  const key = quotaKey(userId, localDate);
  let result: number;
  try {
    result = Number(
      await app.redis.eval(
        RESERVE_QUOTA_SCRIPT,
        1,
        key,
        app.config.AI_DAILY_QUOTA,
        quotaKeyTtlSeconds,
      ),
    );
  } catch {
    throw quotaUnavailableError();
  }
  if (result === -1) {
    throw new AppError(429, 'AI_QUOTA_EXCEEDED', 'The daily AI estimation quota is exhausted.', {
      localDate,
      limit: app.config.AI_DAILY_QUOTA,
    });
  }
  return { key };
}

async function releaseQuota(app: FastifyInstance, key: string): Promise<void> {
  try {
    await app.redis.eval(RELEASE_QUOTA_SCRIPT, 1, key);
  } catch {
    // The reserved count is safer to retain than to risk uncontrolled provider spending.
  }
}

async function readCache<T>(
  app: FastifyInstance,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  let value: string | null;
  try {
    value = await app.redis.get(key);
  } catch {
    throw quotaUnavailableError();
  }
  if (value === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeCache(app: FastifyInstance, key: string, value: unknown): Promise<void> {
  try {
    await app.redis.set(key, JSON.stringify(value), 'EX', app.config.AI_CACHE_TTL_SECONDS);
  } catch {
    throw quotaUnavailableError();
  }
}

async function persistEstimate<T extends { confidence: number }>(
  app: FastifyInstance,
  input: {
    userId: string;
    requestKey: string;
    kind: 'food' | 'exercise';
    inputHash: string;
    providerResult: AIProviderResult<T>;
    cached: boolean;
  },
): Promise<StoredEstimate> {
  const [created] = await app.db
    .insert(aiEstimations)
    .values({
      userId: input.userId,
      requestKey: input.requestKey,
      kind: input.kind,
      inputHash: input.inputHash,
      result: input.providerResult.result,
      confidence: input.providerResult.result.confidence.toString(),
      model: input.providerResult.model,
      inputTokens: input.providerResult.inputTokens,
      outputTokens: input.providerResult.outputTokens,
      cached: input.cached,
    })
    .returning();
  return created!;
}

function serializeFoodEstimate(stored: StoredEstimate, created: boolean) {
  const result = foodEstimateSchema.parse(stored.result);
  return {
    estimationId: stored.id,
    suggestion: {
      foodName: result.foodName,
      quantity: result.quantity,
      unit: result.unit,
      calories: result.calories,
      proteinG: result.proteinG,
      carbsG: result.carbsG,
      fatG: result.fatG,
    },
    assumptions: result.assumptions,
    confidence: result.confidence,
    cached: stored.cached,
    created,
  };
}

function serializeExerciseEstimate(stored: StoredEstimate, created: boolean) {
  const result = exerciseEstimateSchema
    .extend({ caloriesBurned: z.number().min(0).max(100_000) })
    .parse(stored.result);
  return {
    estimationId: stored.id,
    suggestion: {
      exerciseName: result.exerciseName,
      durationMinutes: result.durationMinutes,
      intensity: result.intensity,
      metValue: result.metValue,
      caloriesBurned: result.caloriesBurned,
    },
    assumptions: result.assumptions,
    confidence: result.confidence,
    cached: stored.cached,
    created,
  };
}

function normalizeDescription(description: string): string {
  return description.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function hashInput(app: FastifyInstance, value: string): string {
  return createHmac('sha256', app.config.TOKEN_HASH_SECRET).update(value).digest('hex');
}

function safetyIdentifier(app: FastifyInstance, userId: string): string {
  return createHmac('sha256', app.config.TOKEN_HASH_SECRET)
    .update(`openai-safety:${userId}`)
    .digest('hex');
}

function quotaKey(userId: string, localDate: string): string {
  return `ai:quota:${userId}:${localDate}`;
}

function quotaUnavailableError(): AppError {
  return new AppError(
    503,
    'AI_QUOTA_UNAVAILABLE',
    'AI estimation is temporarily unavailable because quota enforcement is unavailable.',
  );
}

function mapProviderError(error: unknown): unknown {
  if (!(error instanceof AIProviderError)) return error;
  switch (error.reason) {
    case 'refused':
      return new AppError(422, 'AI_ESTIMATION_REFUSED', error.message);
    case 'invalid_response':
      return new AppError(502, 'AI_INVALID_RESPONSE', error.message);
    case 'timeout':
      return new AppError(504, 'AI_PROVIDER_TIMEOUT', error.message);
    case 'unavailable':
      return new AppError(503, 'AI_PROVIDER_UNAVAILABLE', error.message);
  }
}
