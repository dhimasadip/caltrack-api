import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';

import { AppError } from '../errors/app-error.js';

export const securityPlugin = fp(async (app) => {
  const allowedOrigins = new Set(app.config.CORS_ALLOWED_ORIGINS);

  await app.register(cors, {
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    origin: (origin, callback) => {
      if (origin === undefined || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(
        new AppError(403, 'CORS_ORIGIN_DENIED', 'The request origin is not allowed.'),
        false,
      );
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
    ...(app.config.NODE_ENV === 'production' ? {} : { hsts: false }),
  });

  await app.register(rateLimit, {
    global: true,
    max: app.config.API_RATE_LIMIT_MAX,
    timeWindow: app.config.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => request.ip,
    ...(app.hasDecorator('redis') ? { redis: app.redis } : {}),
  });
});
