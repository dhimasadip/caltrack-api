import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { isoDateSchema } from '../../lib/date.js';
import {
  createEligibilityToken,
  loginUser,
  logoutUser,
  registerUser,
  rotateRefreshToken,
} from './auth-service.js';

const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresIn: z.number().int(),
  refreshTokenExpiresIn: z.number().int(),
});

const authenticationResponseSchema = z.object({
  userId: z.uuid(),
  profileComplete: z.boolean(),
  tokens: tokenPairSchema,
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.post('/v1/auth/eligibility', {
    schema: {
      tags: ['auth'],
      body: z.object({
        birthDate: isoDateSchema,
        countryCode: z.string().regex(/^[A-Za-z]{2}$/),
      }),
      response: {
        200: z.object({
          eligibilityToken: z.string(),
          expiresIn: z.number().int(),
          minimumAge: z.number().int(),
        }),
      },
    },
    handler: async (request) =>
      createEligibilityToken(app, request.body.birthDate, request.body.countryCode.toUpperCase()),
  });

  router.post('/v1/auth/register', {
    schema: {
      tags: ['auth'],
      body: z.object({
        eligibilityToken: z.string().min(1),
        email: z.email().max(255),
        password: z.string().min(12).max(128),
      }),
      response: { 201: authenticationResponseSchema },
    },
    handler: async (request, reply) => {
      const result = await registerUser(app, request.body);
      return reply.status(201).send(result);
    },
  });

  router.post('/v1/auth/login', {
    schema: {
      tags: ['auth'],
      body: z.object({ email: z.email().max(255), password: z.string().min(1).max(128) }),
      response: { 200: authenticationResponseSchema },
    },
    handler: async (request) => loginUser(app, request.body.email, request.body.password),
  });

  router.post('/v1/auth/refresh', {
    schema: {
      tags: ['auth'],
      body: z.object({ refreshToken: z.string().min(1) }),
      response: { 200: tokenPairSchema },
    },
    handler: async (request) => rotateRefreshToken(app, request.body.refreshToken),
  });

  router.post('/v1/auth/logout', {
    schema: {
      tags: ['auth'],
      body: z.object({ refreshToken: z.string().min(1) }),
      response: { 204: z.null() },
    },
    handler: async (request, reply) => {
      await logoutUser(app, request.body.refreshToken);
      return reply.status(204).send(null);
    },
  });
}
