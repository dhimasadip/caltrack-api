import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';

import type { AppConfig } from '../config.js';
import type * as schema from '../db/schema.js';
import type { AIProvider } from '../modules/ai/ai-provider.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: NodePgDatabase<typeof schema>;
    pg: Pool;
    redis: Redis;
    aiProvider: AIProvider;
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      type: 'access' | 'refresh' | 'eligibility';
      sub?: string;
      jti?: string;
      familyId?: string;
      birthDate?: string;
      countryCode?: string;
    };
    user: {
      type: 'access' | 'refresh' | 'eligibility';
      sub: string;
      jti?: string;
      familyId?: string;
      birthDate?: string;
      countryCode?: string;
    };
  }
}
