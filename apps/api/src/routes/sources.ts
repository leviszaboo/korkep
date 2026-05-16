import type { FastifyInstance } from 'fastify';
import { getSources } from '../db/queries.js';

export async function sourcesRoutes(app: FastifyInstance) {
  app.get('/api/sources', async () => {
    const sources = await getSources();
    return { data: sources };
  });
}
