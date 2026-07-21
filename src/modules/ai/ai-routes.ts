import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { estimateExercise, estimateFood, getAIQuota } from './ai-service.js';

const estimateInputSchema = z.object({
  requestKey: z.uuid(),
  description: z.string().trim().min(1).max(1_000),
});

const estimateMetadataSchema = z.object({
  estimationId: z.uuid(),
  assumptions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  cached: z.boolean(),
});

const foodResponseSchema = estimateMetadataSchema.extend({
  suggestion: z.object({
    foodName: z.string(),
    quantity: z.number(),
    unit: z.string(),
    calories: z.number(),
    proteinG: z.number().nullable(),
    carbsG: z.number().nullable(),
    fatG: z.number().nullable(),
  }),
});

const exerciseResponseSchema = estimateMetadataSchema.extend({
  suggestion: z.object({
    exerciseName: z.string(),
    durationMinutes: z.number().int(),
    intensity: z.enum(['low', 'moderate', 'high']),
    metValue: z.number(),
    caloriesBurned: z.number(),
  }),
});

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  const router = app.withTypeProvider<ZodTypeProvider>();
  const protectedRoute = { onRequest: [app.authenticate] };

  router.post('/v1/food-entries/ai-estimate', {
    ...protectedRoute,
    schema: {
      tags: ['AI estimation'],
      security: [{ bearerAuth: [] }],
      body: estimateInputSchema,
      response: { 200: foodResponseSchema, 201: foodResponseSchema },
    },
    handler: async (request, reply) => {
      const result = await estimateFood(app, request.user.sub, request.body);
      return reply.status(result.created ? 201 : 200).send(result);
    },
  });

  router.post('/v1/exercise-entries/ai-estimate', {
    ...protectedRoute,
    schema: {
      tags: ['AI estimation'],
      security: [{ bearerAuth: [] }],
      body: estimateInputSchema,
      response: { 200: exerciseResponseSchema, 201: exerciseResponseSchema },
    },
    handler: async (request, reply) => {
      const result = await estimateExercise(app, request.user.sub, request.body);
      return reply.status(result.created ? 201 : 200).send(result);
    },
  });

  router.get('/v1/ai/quota', {
    ...protectedRoute,
    schema: {
      tags: ['AI estimation'],
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          localDate: z.string(),
          timeZone: z.string(),
          limit: z.number().int(),
          used: z.number().int(),
          remaining: z.number().int(),
        }),
      },
    },
    handler: async (request) => getAIQuota(app, request.user.sub),
  });
}
