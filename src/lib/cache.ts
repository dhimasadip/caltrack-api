import type { FastifyInstance } from 'fastify';

export async function invalidateUserReports(app: FastifyInstance, userId: string): Promise<void> {
  try {
    await app.redis.incr(`reports:version:${userId}`);
  } catch (error) {
    app.log.warn({ err: error, userId }, 'Failed to invalidate report cache');
  }
}
