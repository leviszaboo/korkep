import type { FastifyInstance } from 'fastify';
import { getStories, getStoryById, type SortMode } from '../db/queries.js';

export async function storiesRoutes(app: FastifyInstance) {
  app.get('/api/stories', async (request, reply) => {
    const { page = '1', limit = '20', topic, sort = 'relevance', since } = request.query as {
      page?: string;
      limit?: string;
      topic?: string;
      sort?: string;
      since?: string;
    };

    const sortMode: SortMode = sort === 'latest' ? 'latest' : 'relevance';

    try {
      return await getStories(Number(page), Number(limit), topic || undefined, sortMode, since || undefined);
    } catch (err) {
      request.log.error({ err }, 'GET /api/stories failed');
      reply.code(500);
      return { error: 'Internal server error' };
    }
  });

  app.get('/api/stories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getStoryById(Number(id));

    if (!result) {
      reply.code(404);
      return { error: 'Story not found' };
    }

    return result;
  });
}
