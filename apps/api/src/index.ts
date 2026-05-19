import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db/index.js';
import { storiesRoutes } from './routes/stories.js';
import { sourcesRoutes } from './routes/sources.js';
import { searchRoutes } from './routes/search.js';
import { registerRateLimit } from './rate-limit.js';

async function main() {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: true,
    trustProxy: true,
  });

  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: Math.round(reply.elapsedTime),
      },
      `${request.method} ${request.url} ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms`,
    );
    done();
  });

  await app.register(cors, { origin: config.cors.origin });
  registerRateLimit(app, config.rateLimit);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(storiesRoutes);
  await app.register(sourcesRoutes);
  await app.register(searchRoutes);

  await app.listen({ host: config.server.host, port: config.server.port });

  const shutdown = async () => {
    logger.info('Shutting down...');
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
