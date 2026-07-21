import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const healthResponse = z.object({ status: z.literal('ok') });
const readyResponse = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({ postgres: z.boolean(), migrations: z.boolean(), redis: z.boolean() }),
});

const expectedMigrationCount = 3;

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', {
    schema: {
      tags: ['operations'],
      summary: 'Process liveness',
      response: { 200: healthResponse },
    },
    handler: async () => ({ status: 'ok' as const }),
  });

  app.get('/ready', {
    schema: {
      tags: ['operations'],
      summary: 'PostgreSQL, migration, and Redis readiness',
      response: { 200: readyResponse, 503: readyResponse },
    },
    handler: async (_request, reply) => {
      let postgres = false;
      let migrations = false;
      let redis = false;

      try {
        if (app.hasDecorator('pg')) {
          await app.pg.query('select 1');
          postgres = true;
          const migrationResult = await app.pg.query<{ count: string }>(
            'select count(*) from drizzle.__drizzle_migrations',
          );
          migrations = Number(migrationResult.rows[0]?.count ?? 0) >= expectedMigrationCount;
        }
      } catch {
        postgres = false;
        migrations = false;
      }

      try {
        if (app.hasDecorator('redis')) {
          redis = (await app.redis.ping()) === 'PONG';
        }
      } catch {
        redis = false;
      }

      const available = postgres && migrations && redis;
      return reply.status(available ? 200 : 503).send({
        status: available ? 'ok' : 'unavailable',
        checks: { postgres, migrations, redis },
      });
    },
  });
}
