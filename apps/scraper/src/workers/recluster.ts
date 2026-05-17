import { Worker } from 'bullmq';
import { config } from '../config.js';
import { runRecluster } from '../processors/recluster.js';
import { logger } from '../logger.js';

export function startReclusterWorker() {
  const worker = new Worker(
    'recluster',
    async () => {
      const startTime = Date.now();
      logger.info('Periodic recluster started');
      await runRecluster('scheduled_recluster');
      logger.info({ durationMs: Date.now() - startTime }, 'Periodic recluster finished');
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
      lockDuration: 300_000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Recluster job failed');
  });

  return worker;
}
