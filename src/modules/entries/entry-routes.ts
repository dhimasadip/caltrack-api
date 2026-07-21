import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { isoDateSchema } from '../../lib/date.js';
import {
  createExerciseEntry,
  createFoodEntry,
  deleteExerciseEntry,
  deleteFoodEntry,
  getExerciseEntry,
  getFoodEntry,
  listExerciseEntries,
  listFoodEntries,
  updateExerciseEntry,
  updateFoodEntry,
} from './entry-service.js';

const entryParamsSchema = z.object({ id: z.uuid() });
const listQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: '`from` must be before or equal to `to`.',
  });

const foodInputSchema = z
  .object({
    entryDate: isoDateSchema,
    mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
    foodName: z.string().trim().min(1).max(255),
    quantity: z.number().positive().max(1_000_000),
    unit: z.string().trim().min(1).max(50),
    calories: z.number().min(0).max(100_000),
    proteinG: z.number().min(0).max(10_000).nullable().optional(),
    carbsG: z.number().min(0).max(10_000).nullable().optional(),
    fatG: z.number().min(0).max(10_000).nullable().optional(),
    aiEstimationId: z.uuid().nullable().optional(),
  })
  .meta({
    example: {
      entryDate: '2026-07-21',
      mealType: 'lunch',
      foodName: 'Chicken rice',
      quantity: 1,
      unit: 'plate',
      calories: 560,
      proteinG: 32,
      carbsG: 65,
      fatG: 18,
    },
  });

const foodEntrySchema = foodInputSchema.extend({
  id: z.uuid(),
  clientEntryId: z.uuid(),
  proteinG: z.number().nullable(),
  carbsG: z.number().nullable(),
  fatG: z.number().nullable(),
  source: z.enum(['manual', 'ai']),
  aiEstimationId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const exerciseInputSchema = z
  .object({
    entryDate: isoDateSchema,
    exerciseName: z.string().trim().min(1).max(255),
    durationMinutes: z
      .number()
      .int()
      .positive()
      .max(24 * 60),
    intensity: z.enum(['low', 'moderate', 'high']).nullable().optional(),
    caloriesBurned: z.number().min(0).max(100_000),
    notes: z.string().trim().max(2_000).nullable().optional(),
    aiEstimationId: z.uuid().nullable().optional(),
  })
  .meta({
    example: {
      entryDate: '2026-07-21',
      exerciseName: 'Jogging',
      durationMinutes: 30,
      intensity: 'moderate',
      caloriesBurned: 257.25,
      notes: 'Steady pace',
    },
  });

const exerciseEntrySchema = exerciseInputSchema.extend({
  id: z.uuid(),
  clientEntryId: z.uuid(),
  intensity: z.enum(['low', 'moderate', 'high']).nullable(),
  notes: z.string().nullable(),
  source: z.enum(['manual', 'ai']),
  aiEstimationId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export async function entryRoutes(app: FastifyInstance): Promise<void> {
  const router = app.withTypeProvider<ZodTypeProvider>();
  const protectedRoute = { onRequest: [app.authenticate] };

  router.post('/v1/food-entries', {
    ...protectedRoute,
    schema: {
      tags: ['food entries'],
      summary: 'Create or replay a food entry',
      security: [{ bearerAuth: [] }],
      body: foodInputSchema.extend({ clientEntryId: z.uuid() }),
      response: { 200: foodEntrySchema, 201: foodEntrySchema },
    },
    handler: async (request, reply) => {
      const result = await createFoodEntry(app, request.user.sub, request.body);
      return reply.status(result.created ? 201 : 200).send(result.entry);
    },
  });

  router.get('/v1/food-entries', {
    ...protectedRoute,
    schema: {
      tags: ['food entries'],
      summary: 'List food entries with opaque cursor pagination',
      security: [{ bearerAuth: [] }],
      querystring: listQuerySchema,
      response: {
        200: z.object({ items: z.array(foodEntrySchema), nextCursor: z.string().nullable() }),
      },
    },
    handler: async (request) => listFoodEntries(app, request.user.sub, request.query),
  });

  router.get('/v1/food-entries/:id', {
    ...protectedRoute,
    schema: {
      tags: ['food entries'],
      summary: 'Get one food entry',
      security: [{ bearerAuth: [] }],
      params: entryParamsSchema,
      response: { 200: foodEntrySchema },
    },
    handler: async (request) => getFoodEntry(app, request.user.sub, request.params.id),
  });

  router.put('/v1/food-entries/:id', {
    ...protectedRoute,
    schema: {
      tags: ['food entries'],
      summary: 'Replace one food entry',
      security: [{ bearerAuth: [] }],
      params: entryParamsSchema,
      body: foodInputSchema,
      response: { 200: foodEntrySchema },
    },
    handler: async (request) =>
      updateFoodEntry(app, request.user.sub, request.params.id, request.body),
  });

  router.delete('/v1/food-entries/:id', {
    ...protectedRoute,
    schema: {
      tags: ['food entries'],
      summary: 'Delete one food entry',
      security: [{ bearerAuth: [] }],
      params: entryParamsSchema,
      response: { 204: z.null() },
    },
    handler: async (request, reply) => {
      await deleteFoodEntry(app, request.user.sub, request.params.id);
      return reply.status(204).send(null);
    },
  });

  router.post('/v1/exercise-entries', {
    ...protectedRoute,
    schema: {
      tags: ['exercise entries'],
      summary: 'Create or replay an exercise entry',
      security: [{ bearerAuth: [] }],
      body: exerciseInputSchema.extend({ clientEntryId: z.uuid() }),
      response: { 200: exerciseEntrySchema, 201: exerciseEntrySchema },
    },
    handler: async (request, reply) => {
      const result = await createExerciseEntry(app, request.user.sub, request.body);
      return reply.status(result.created ? 201 : 200).send(result.entry);
    },
  });

  router.get('/v1/exercise-entries', {
    ...protectedRoute,
    schema: {
      tags: ['exercise entries'],
      summary: 'List exercise entries with opaque cursor pagination',
      security: [{ bearerAuth: [] }],
      querystring: listQuerySchema,
      response: {
        200: z.object({ items: z.array(exerciseEntrySchema), nextCursor: z.string().nullable() }),
      },
    },
    handler: async (request) => listExerciseEntries(app, request.user.sub, request.query),
  });

  router.get('/v1/exercise-entries/:id', {
    ...protectedRoute,
    schema: {
      tags: ['exercise entries'],
      summary: 'Get one exercise entry',
      security: [{ bearerAuth: [] }],
      params: entryParamsSchema,
      response: { 200: exerciseEntrySchema },
    },
    handler: async (request) => getExerciseEntry(app, request.user.sub, request.params.id),
  });

  router.put('/v1/exercise-entries/:id', {
    ...protectedRoute,
    schema: {
      tags: ['exercise entries'],
      summary: 'Replace one exercise entry',
      security: [{ bearerAuth: [] }],
      params: entryParamsSchema,
      body: exerciseInputSchema,
      response: { 200: exerciseEntrySchema },
    },
    handler: async (request) =>
      updateExerciseEntry(app, request.user.sub, request.params.id, request.body),
  });

  router.delete('/v1/exercise-entries/:id', {
    ...protectedRoute,
    schema: {
      tags: ['exercise entries'],
      summary: 'Delete one exercise entry',
      security: [{ bearerAuth: [] }],
      params: entryParamsSchema,
      response: { 204: z.null() },
    },
    handler: async (request, reply) => {
      await deleteExerciseEntry(app, request.user.sub, request.params.id);
      return reply.status(204).send(null);
    },
  });
}
