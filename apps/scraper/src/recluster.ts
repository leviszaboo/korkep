import { runRecluster } from './processors/recluster.js';
import { pool } from './lib/db.js';
import { logger } from './logger.js';

async function main() {
    logger.info('Starting recluster (keeping existing embeddings)');

    await runRecluster();

    await pool.end();
    logger.info('Recluster finished, exiting');
    process.exit(0);
}

main().catch((err) => {
    logger.fatal({ err }, 'Recluster failed');
    process.exit(1);
});
