import jwt from '@fastify/jwt';
import fp from 'fastify-plugin';

import { AppError } from '../errors/app-error.js';

export const authPlugin = fp(async (app) => {
  await app.register(jwt, { secret: app.config.JWT_SECRET });

  app.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'A valid access token is required.');
    }

    if (request.user.type !== 'access' || request.user.sub === undefined) {
      throw new AppError(401, 'UNAUTHORIZED', 'A valid access token is required.');
    }
  });
});
