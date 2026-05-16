import type { FastifyInstance } from 'fastify';
import { searchStories } from '../db/queries.js';

export async function searchRoutes(app: FastifyInstance) {
  app.get('/api/search', async (request, reply) => {
    const { q } = request.query as { q?: string };

    if (!q || q.trim().length === 0) {
      reply.code(400);
      return { error: 'Query parameter "q" is required' };
    }

    const results = await searchStories(q.trim());
    return { data: results };
  });
}
