import { config } from './config.js';
import { runFullRecluster } from './workers/backfill.js';
import { pool } from './lib/db.js';
import { logger } from './logger.js';

async function main() {
    const startTime = Date.now();
    logger.info({ model: config.openrouter.model }, 'Full re-embed started');

    await runFullRecluster('manual_reembed');

    const durationMs = Date.now() - startTime;
    await pool.end();
    logger.info({ durationMs }, 'Full re-embed finished');
    process.exit(0);
}

main().catch((err) => {
    logger.fatal({ err }, 'Recluster failed');
    process.exit(1);
});
