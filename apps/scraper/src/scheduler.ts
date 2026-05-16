import { SOURCES } from '@korkep/shared';
import { scrapeQueue, reclusterQueue } from './queue.js';
import { logger } from './logger.js';

export async function startScheduler() {
  for (const source of SOURCES) {
    if (!source.rssUrl) {
      logger.info({ slug: source.slug }, 'Skipping source without RSS (no adapter yet)');
      continue;
    }

    await scrapeQueue.upsertJobScheduler(
      `scrape:${source.slug}`,
      { every: source.scrapeIntervalMinutes * 60 * 1000 },
      {
        name: `scrape:${source.slug}`,
        data: { sourceSlug: source.slug },
      },
    );

    logger.info(
      { slug: source.slug, intervalMin: source.scrapeIntervalMinutes },
      'Scheduled scrape job',
    );
  }

  await reclusterQueue.upsertJobScheduler(
    'recluster',
    { every: 1 * 60 * 60 * 1000 },
    { name: 'recluster', data: {} },
  );

  logger.info('Scheduled recluster job every hour');
}
