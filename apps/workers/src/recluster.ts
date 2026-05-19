import { runRecluster } from './processors/recluster.js';
import { pool } from './lib/db.js';
import { logger } from './logger.js';
import { buildActivity, type TriggerMode } from './lib/llm-usage.js';

async function main() {
    const startTime = Date.now();
    logger.info('Recluster-only started (keeping existing embeddings)');

    const trigger = (process.env.TRIGGER_MODE ?? 'manual') as TriggerMode;
    await runRecluster(buildActivity(trigger, 'recluster', 'storytitle'));

    const durationMs = Date.now() - startTime;
    await pool.end();
    logger.info({ durationMs }, 'Recluster-only finished');
    process.exit(0);
}

main().catch((err) => {
    logger.fatal({ err }, 'Recluster failed');
    process.exit(1);
});
