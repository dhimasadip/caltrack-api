import type { FastifyInstance } from 'fastify';

export async function invalidateUserReports(app: FastifyInstance, userId: string): Promise<void> {
  try {
    await app.redis.incr(`reports:version:${userId}`);
  } catch (error) {
    app.log.warn({ err: error, userId }, 'Failed to invalidate report cache');
  }
}

export async function deleteKeysMatching(
  app: FastifyInstance,
  patterns: readonly string[],
): Promise<void> {
  for (const pattern of patterns) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await app.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) await app.redis.del(...keys);
    } while (cursor !== '0');
  }
}
