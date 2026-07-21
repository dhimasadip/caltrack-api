import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { isoDateSchema, isValidTimeZone } from '../../lib/date.js';
import {
  deleteCurrentUser,
  getCurrentUser,
  updateProfile,
  updateSettings,
} from './user-service.js';

const notificationPreferencesSchema = z.object({
  breakfast: z.boolean(),
  lunch: z.boolean(),
  dinner: z.boolean(),
  weighIn: z.boolean(),
});

const profileSchema = z.object({
  birthDate: isoDateSchema,
  countryCode: z.string().length(2),
  gender: z.enum(['male', 'female', 'other']).nullable(),
  heightCm: z.number().nullable(),
  weightKg: z.number().nullable(),
  activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']).nullable(),
  goalType: z.enum(['lose', 'maintain', 'gain']).nullable(),
  targetWeightKg: z.number().nullable(),
  targetDate: isoDateSchema.nullable(),
  dailyCalorieGoal: z.number().int().nullable(),
  suggestedCalorieGoal: z.number().int().nullable(),
  bmr: z.number().nullable(),
  tdee: z.number().nullable(),
  calculationMethod: z.enum(['dri_2023_eer', 'mifflin_st_jeor']).nullable(),
  calculationAssumptions: z.array(z.string()),
  timeZone: z.string(),
  unitSystem: z.enum(['metric', 'imperial']),
  notificationPreferences: notificationPreferencesSchema,
  onboardingComplete: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.get('/v1/users/me', {
    onRequest: [app.authenticate],
    schema: {
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          id: z.uuid(),
          email: z.email(),
          createdAt: z.iso.datetime(),
          ageBand: z.enum(['teen', 'adult']),
          adPersonalizationAllowed: z.boolean(),
          profile: profileSchema,
        }),
      },
    },
    handler: async (request) => getCurrentUser(app, request.user.sub),
  });

  router.put('/v1/users/me/profile', {
    onRequest: [app.authenticate],
    schema: {
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      body: z.object({
        gender: z.enum(['male', 'female', 'other']),
        heightCm: z.number().min(50).max(300),
        weightKg: z.number().min(20).max(500),
        activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']),
        goalType: z.enum(['lose', 'maintain', 'gain']),
        targetWeightKg: z.number().min(20).max(500).nullable().optional(),
        targetDate: isoDateSchema.nullable().optional(),
        dailyCalorieGoal: z.number().int().min(800).max(10_000).optional(),
      }),
      response: { 200: profileSchema },
    },
    handler: async (request) => updateProfile(app, request.user.sub, request.body),
  });

  router.put('/v1/users/me/settings', {
    onRequest: [app.authenticate],
    schema: {
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      body: z
        .object({
          timeZone: z.string().refine(isValidTimeZone, 'Invalid IANA time zone').optional(),
          unitSystem: z.enum(['metric', 'imperial']).optional(),
          notificationPreferences: notificationPreferencesSchema.optional(),
        })
        .refine((value) => Object.keys(value).length > 0, 'At least one setting is required'),
      response: { 200: profileSchema },
    },
    handler: async (request) => updateSettings(app, request.user.sub, request.body),
  });

  router.delete('/v1/users/me', {
    onRequest: [app.authenticate],
    schema: {
      tags: ['users'],
      security: [{ bearerAuth: [] }],
      response: { 204: z.null() },
    },
    handler: async (request, reply) => {
      await deleteCurrentUser(app, request.user.sub);
      return reply.status(204).send(null);
    },
  });
}
