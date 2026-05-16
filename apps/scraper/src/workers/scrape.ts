import { Worker, type Job } from 'bullmq';
import { config } from '../config.js';
import { processQueue } from '../queue.js';
import { TelexAdapter } from '../adapters/telex.js';
import { FourFourFourAdapter } from '../adapters/444.js';
import { IndexHuAdapter } from '../adapters/index-hu.js';
import { HvgAdapter } from '../adapters/hvg.js';
import { MagyarNemzetAdapter } from '../adapters/magyar-nemzet.js';
import { OrigoAdapter } from '../adapters/origo.js';
import { TwentyFourHuAdapter } from '../adapters/24hu.js';
import { MandinerAdapter } from '../adapters/mandiner.js';
import { BlikkAdapter } from '../adapters/blikk.js';
import { HangAdapter } from '../adapters/hang.js';
import type { BaseAdapter } from '../adapters/base.js';
import { logger } from '../logger.js';

const adapters: Record<string, BaseAdapter> = {
  telex: new TelexAdapter(),
  '444': new FourFourFourAdapter(),
  index: new IndexHuAdapter(),
  hvg: new HvgAdapter(),
  'magyar-nemzet': new MagyarNemzetAdapter(),
  origo: new OrigoAdapter(),
  '24hu': new TwentyFourHuAdapter(),
  mandiner: new MandinerAdapter(),
  blikk: new BlikkAdapter(),
  hang: new HangAdapter(),
};

export function startScrapeWorker() {
  const worker = new Worker(
    'scrape',
    async (job: Job<{ sourceSlug: string }>) => {
      const { sourceSlug } = job.data;
      const adapter = adapters[sourceSlug];

      if (!adapter) {
        logger.warn({ sourceSlug }, 'No adapter found for source');
        return;
      }

      logger.info({ sourceSlug }, 'Starting scrape');
      const articles = await adapter.fetchArticles();
      logger.info({ sourceSlug, count: articles.length }, 'Fetched articles');

      await processQueue.addBulk(
        articles.map((article) => ({
          name: 'process-article',
          data: article,
          opts: { jobId: `article:${article.url}` },
        })),
      );
    },
    {
      connection: { url: config.redis.url },
      concurrency: 5,
      lockDuration: 120_000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Scrape job failed');
  });

  return worker;
}
