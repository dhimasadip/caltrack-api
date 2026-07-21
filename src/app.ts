import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import { type AppConfig, loadConfig } from './config.js';
import { registerErrorHandler } from './errors/error-handler.js';
import { authRoutes } from './modules/auth/auth-routes.js';
import type { AIProvider } from './modules/ai/ai-provider.js';
import { aiRoutes } from './modules/ai/ai-routes.js';
import { entryRoutes } from './modules/entries/entry-routes.js';
import { reportRoutes } from './modules/reports/report-routes.js';
import { userRoutes } from './modules/users/user-routes.js';
import { authPlugin } from './plugins/auth.js';
import { aiProviderPlugin } from './plugins/ai-provider.js';
import { databasePlugin } from './plugins/database.js';
import { redisPlugin } from './plugins/redis.js';
import { securityPlugin } from './plugins/security.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  config?: AppConfig;
  infrastructure?: boolean;
  aiProvider?: AIProvider;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    bodyLimit: config.BODY_LIMIT_BYTES,
    requestTimeout: config.REQUEST_TIMEOUT_MS,
    trustProxy: config.TRUST_PROXY,
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers.set-cookie',
                'password',
                'eligibilityToken',
                'accessToken',
                'refreshToken',
                '*.password',
                '*.eligibilityToken',
                '*.accessToken',
                '*.refreshToken',
              ],
              censor: '[REDACTED]',
            },
          },
  });

  app.decorate('config', config);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  if (options.infrastructure !== false) {
    await app.register(databasePlugin);
    await app.register(redisPlugin);
  }

  await app.register(securityPlugin);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CalTrack API',
        description:
          'Backend-only REST API for age-gated accounts, calorie tracking, reports, and editable AI suggestions. All error responses use the standard error envelope.',
        version: '1.0.0',
      },
      servers: [{ url: '/', description: 'Current server' }],
      tags: [
        { name: 'auth', description: 'Eligibility, registration, and token lifecycle.' },
        { name: 'users', description: 'Current-user profile, settings, and deletion.' },
        { name: 'food entries', description: 'Idempotent food-entry management.' },
        { name: 'exercise entries', description: 'Idempotent exercise-entry management.' },
        { name: 'reports', description: 'Daily-series and aggregate calorie reports.' },
        {
          name: 'AI estimation',
          description: 'Quota-controlled editable suggestions; estimates are never auto-saved.',
        },
        { name: 'operations', description: 'Liveness and dependency readiness.' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
        examples: {
          standardError: {
            summary: 'Standard error envelope',
            value: {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'The request is invalid.',
                details: [],
                requestId: 'req-1',
              },
            },
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(authPlugin);
  await app.register(
    aiProviderPlugin,
    options.aiProvider === undefined ? {} : { provider: options.aiProvider },
  );

  await app.register(healthRoutes);
  await app.register(aiRoutes);
  await app.register(authRoutes);
  await app.register(entryRoutes);
  await app.register(reportRoutes);
  await app.register(userRoutes);
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  return app;
}
