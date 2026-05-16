import { config } from './config.js';
import { runFullRecluster } from './workers/backfill.js';
import { pool } from './lib/db.js';
import { logger } from './logger.js';

async function main() {
    logger.info('Starting full recluster');
    logger.info({ model: config.openrouter.model }, 'Config');

    await runFullRecluster();

    await pool.end();
    logger.info('Recluster finished, exiting');
    process.exit(0);
}

main().catch((err) => {
    logger.fatal({ err }, 'Recluster failed');
    process.exit(1);
});
