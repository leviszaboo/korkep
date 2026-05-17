import { Worker } from 'bullmq';
import { config } from '../config.js';
import { runRepair } from './repair.js';
import { logger } from '../logger.js';

export function startRepairWorker() {
  const worker = new Worker(
    'repair',
    async () => {
      const startTime = Date.now();
      logger.info('Repair worker started');
      await runRepair('scheduled_repair');
      logger.info({ durationMs: Date.now() - startTime }, 'Repair worker finished');
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
      lockDuration: 300_000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Repair job failed');
  });

  return worker;
}
