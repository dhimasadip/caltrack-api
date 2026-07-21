import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';

import type { AppConfig } from '../config.js';
import type * as schema from '../db/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: NodePgDatabase<typeof schema>;
    pg: Pool;
    redis: Redis;
  }
}
