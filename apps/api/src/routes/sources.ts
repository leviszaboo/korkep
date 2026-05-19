import type { FastifyInstance } from 'fastify';
import { getSources, getSharedStories } from '../db/queries.js';

export async function sourcesRoutes(app: FastifyInstance) {
  app.get('/api/sources', async () => {
    const sources = await getSources();
    return { data: sources };
  });

  app.get('/api/sources/compare', async (request, reply) => {
    const { a, b } = request.query as { a?: string; b?: string };
    if (!a || !b) {
      reply.code(400);
      return { error: 'Both "a" and "b" query parameters are required' };
    }
    try {
      const stories = await getSharedStories(a, b);
      return { data: stories };
    } catch (err) {
      request.log.error({ err }, 'GET /api/sources/compare failed');
      reply.code(500);
      return { error: 'Internal server error' };
    }
  });
}
