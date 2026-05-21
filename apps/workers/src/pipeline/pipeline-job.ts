import { pathToFileURL } from 'node:url';
import { pool } from '../lib/db.js';
import { logger } from '../logger.js';
import { disconnectQueue } from './queue.js';
import { runEmbedClusterStage, type EmbedClusterStageResult } from './embed-cluster-job.js';
import { runProcessStage, type ProcessStageResult } from './process-job.js';
import { runScrapeStage, type ScrapeStageResult } from './scrape-job.js';

type PipelineStages = {
  scrape: () => Promise<ScrapeStageResult>;
  process: () => Promise<ProcessStageResult>;
  embed: () => Promise<EmbedClusterStageResult>;
};

export type PipelineResult = {
  scrape: ScrapeStageResult;
  process: ProcessStageResult | null;
  embed: EmbedClusterStageResult | null;
  durationMs: number;
};

export async function runPipelineStages(
  stages: PipelineStages = {
    scrape: runScrapeStage,
    process: runProcessStage,
    embed: runEmbedClusterStage,
  },
): Promise<PipelineResult> {
  const startTime = Date.now();
  logger.info('Combined pipeline job started');

  const scrape = await stages.scrape();
  if (scrape.newArticleIds.length === 0) {
    const durationMs = Date.now() - startTime;
    logger.info({ durationMs, scrape }, 'Combined pipeline job finished with no new articles');
    return { scrape, process: null, embed: null, durationMs };
  }

  const process = await stages.process();
  if (process.processed === 0 || process.succeeded === 0) {
    const durationMs = Date.now() - startTime;
    logger.info({ durationMs, scrape, process }, 'Combined pipeline job finished with no articles to embed');
    return { scrape, process, embed: null, durationMs };
  }

  const embed = await stages.embed();
  const durationMs = Date.now() - startTime;
  logger.info({ durationMs, scrape, process, embed }, 'Combined pipeline job finished');
  return { scrape, process, embed, durationMs };
}

export async function main() {
  try {
    await runPipelineStages();
  } finally {
    try {
      logger.debug('Disconnecting queue');
      await disconnectQueue();
      logger.debug('Queue disconnected');
    } catch (err) {
      logger.error({ err }, 'Error disconnecting queue');
    }

    try {
      logger.debug('Closing database pool');
      await pool.end();
      logger.debug('Database pool closed');
    } catch (err) {
      logger.error({ err }, 'Error closing database pool');
    }
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main()
    .then(() => {
      logger.info('Combined pipeline job completed successfully');
      setTimeout(() => {
        process.exit(0);
      }, 500);
    })
    .catch((err) => {
      logger.fatal({ err }, 'Combined pipeline job failed');
      setTimeout(() => {
        process.exit(1);
      }, 500);
    });
}
