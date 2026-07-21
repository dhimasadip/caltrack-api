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
import { userRoutes } from './modules/users/user-routes.js';
import { authPlugin } from './plugins/auth.js';
import { databasePlugin } from './plugins/database.js';
import { redisPlugin } from './plugins/redis.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  config?: AppConfig;
  infrastructure?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
          },
  });

  app.decorate('config', config);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CalTrack API',
        description: 'Backend API for calorie and exercise tracking.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  if (options.infrastructure !== false) {
    await app.register(databasePlugin);
    await app.register(redisPlugin);
  }

  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  return app;
}
