import { runRepair } from './processors/repair.js';
import { pool } from './lib/db.js';
import { logger } from './logger.js';

async function main() {
    const startTime = Date.now();
    logger.info('Repair started');

    await runRepair('manual_repair');

    const durationMs = Date.now() - startTime;
    await pool.end();
    logger.info({ durationMs }, 'Repair finished');
    process.exit(0);
}

main().catch((err) => {
    logger.fatal({ err }, 'Repair failed');
    process.exit(1);
});
