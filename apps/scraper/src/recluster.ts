import { runRecluster } from './processors/recluster.js';
import { pool } from './lib/db.js';
import { logger } from './logger.js';

async function main() {
    const startTime = Date.now();
    logger.info('Recluster-only started (keeping existing embeddings)');

    await runRecluster('manual_recluster');

    const durationMs = Date.now() - startTime;
    await pool.end();
    logger.info({ durationMs }, 'Recluster-only finished');
    process.exit(0);
}

main().catch((err) => {
    logger.fatal({ err }, 'Recluster failed');
    process.exit(1);
});
