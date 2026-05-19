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
import { EuronewsHuAdapter } from '../adapters/euronews-hu.js';
import { MetropolAdapter } from '../adapters/metropol.js';
import { RipostAdapter } from '../adapters/ripost.js';
import { AtvAdapter } from '../adapters/atv.js';
import { PortfolioAdapter } from '../adapters/portfolio.js';
import { VgAdapter } from '../adapters/vg.js';
import { InfostartAdapter } from '../adapters/infostart.js';
import { PestiSracokAdapter } from '../adapters/pesti-sracok.js';
import { MtiAdapter } from '../adapters/mti.js';
import { KontrollAdapter } from '../adapters/kontroll.js';
import { DemokrataAdapter } from '../adapters/demokrata.js';
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
  'euronews-hu': new EuronewsHuAdapter(),
  metropol: new MetropolAdapter(),
  ripost: new RipostAdapter(),
  atv: new AtvAdapter(),
  portfolio: new PortfolioAdapter(),
  vg: new VgAdapter(),
  infostart: new InfostartAdapter(),
  'pesti-sracok': new PestiSracokAdapter(),
  mti: new MtiAdapter(),
  kontroll: new KontrollAdapter(),
  demokrata: new DemokrataAdapter(),
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

      const startTime = Date.now();
      logger.debug({ sourceSlug }, 'Scrape started');

      const articles = await adapter.fetchArticles();
      const durationMs = Date.now() - startTime;
      const stats = adapter.getStats();

      const hasDiagnostics = stats.skipped > 0 || stats.fetchFailed > 0 || stats.extractionDegraded > 0;
      if (hasDiagnostics) {
        logger.info(
          {
            sourceSlug,
            count: articles.length,
            durationMs,
            skipped: stats.skipped,
            fetchFailed: stats.fetchFailed,
            degraded: stats.extractionDegraded,
          },
          'Scrape completed with diagnostics',
        );
      } else {
        logger.debug(
          { sourceSlug, count: articles.length, durationMs },
          'Scrape completed',
        );
      }

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
