import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { reportQuerySchema, reportResponseSchema } from './report-contract.js';
import { getReport } from './report-service.js';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.get('/v1/reports/summary', {
    onRequest: [app.authenticate],
    schema: {
      tags: ['reports'],
      security: [{ bearerAuth: [] }],
      querystring: reportQuerySchema,
      response: { 200: reportResponseSchema },
    },
    handler: async (request) => getReport(app, request.user.sub, request.query),
  });
}
