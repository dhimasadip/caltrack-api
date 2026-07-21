import fp from 'fastify-plugin';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../db/schema.js';

export const databasePlugin = fp(async (app) => {
  const pool = new Pool({ connectionString: app.config.DATABASE_URL });
  const db = drizzle(pool, { schema });

  app.decorate('pg', pool);
  app.decorate('db', db);

  app.addHook('onClose', async () => {
    await pool.end();
  });
});
