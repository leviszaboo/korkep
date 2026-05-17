import { config } from './config.js';
import { startScrapeWorker } from './workers/scrape.js';
import { startProcessWorker } from './workers/process.js';
import { startReclusterWorker } from './workers/recluster.js';
import { startRepairWorker } from './workers/repair-worker.js';
import { startScheduler } from './scheduler.js';
import { logger } from './logger.js';

async function main() {
  logger.info('Starting scraper service');
  logger.info({ redis: config.redis.url, model: config.openrouter.model }, 'Config');

  const scrapeWorker = startScrapeWorker();
  const processWorker = startProcessWorker();
  const reclusterWorker = startReclusterWorker();
  const repairWorker = startRepairWorker();

  await startScheduler();

  logger.info('Scraper service running');

  const shutdown = async () => {
    logger.info('Shutting down...');
    await scrapeWorker.close();
    await processWorker.close();
    await reclusterWorker.close();
    await repairWorker.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start scraper');
  process.exit(1);
});
