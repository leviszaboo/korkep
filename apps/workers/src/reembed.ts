import { config } from './config.js';
import { runFullRecluster } from './processors/backfill.js';
import { pool } from './lib/db.js';
import { logger } from './logger.js';
import { buildActivity } from './lib/llm-usage.js';

async function main() {
    const startTime = Date.now();
    logger.info({ model: config.embedding.model }, 'Full re-embed started');

    const activity = buildActivity('manual', 'reembed', 'embedding');
    await runFullRecluster(activity);

    const durationMs = Date.now() - startTime;
    await pool.end();
    logger.info({ durationMs }, 'Full re-embed finished');
    process.exit(0);
}

main().catch((err) => {
    logger.fatal({ err }, 'Recluster failed');
    process.exit(1);
});
