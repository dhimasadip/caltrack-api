import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const healthResponse = z.object({ status: z.literal('ok') });
const readyResponse = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({ postgres: z.boolean(), redis: z.boolean() }),
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', {
    schema: {
      tags: ['operations'],
      response: { 200: healthResponse },
    },
    handler: async () => ({ status: 'ok' as const }),
  });

  app.get('/ready', {
    schema: {
      tags: ['operations'],
      response: { 200: readyResponse, 503: readyResponse },
    },
    handler: async (_request, reply) => {
      let postgres = false;
      let redis = false;

      try {
        if (app.hasDecorator('pg')) {
          await app.pg.query('select 1');
          postgres = true;
        }
      } catch {
        postgres = false;
      }

      try {
        if (app.hasDecorator('redis')) {
          redis = (await app.redis.ping()) === 'PONG';
        }
      } catch {
        redis = false;
      }

      const available = postgres && redis;
      return reply.status(available ? 200 : 503).send({
        status: available ? 'ok' : 'unavailable',
        checks: { postgres, redis },
      });
    },
  });
}
