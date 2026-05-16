import { Worker } from 'bullmq';
import { config } from '../config.js';
import { runRecluster } from '../processors/recluster.js';
import { logger } from '../logger.js';

export function startReclusterWorker() {
  const worker = new Worker(
    'recluster',
    async () => {
      logger.info('Starting periodic recluster');
      await runRecluster();
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
