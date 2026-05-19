import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 500, 3000),
      lazyConnect: true,
    });
    redis.on('error', (err) => {
      logger.warn({ err: err.message }, 'Pipeline Redis error');
    });
  }
  return redis;
}

export const QUEUE_PROCESS = 'pipeline:process';
export const QUEUE_PROCESSING_PROCESS = 'pipeline:process:processing';
export const QUEUE_EMBED = 'pipeline:embed';
export const QUEUE_PROCESSING_EMBED = 'pipeline:embed:processing';

export function normalizeQueueIds(values: string[]): number[] {
  return values
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

export async function queuePush(queueName: string, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const r = getRedis();
  await r.connect().catch(() => {});
  const values = ids.map(String);
  await r.rpush(queueName, ...values);
  logger.info({ queue: queueName, count: ids.length }, 'Pushed to queue');
}

export async function queueClaimBatch(
  queueName: string,
  processingQueueName: string,
  limit: number,
): Promise<number[]> {
  if (limit <= 0) return [];
  const r = getRedis();
  await r.connect().catch(() => {});

  const script = `
    local claimed = {}
    local limit = tonumber(ARGV[1])
    for i = 1, limit do
      local value = redis.call('lpop', KEYS[1])
      if not value then break end
      redis.call('rpush', KEYS[2], value)
      table.insert(claimed, value)
    end
    return claimed
  `;

  const values = await r.eval(script, 2, queueName, processingQueueName, String(limit)) as string[];
  const ids = normalizeQueueIds(values);
  logger.info({ queue: queueName, processingQueue: processingQueueName, count: ids.length }, 'Claimed queue batch');
  return ids;
}

export async function queueAck(processingQueueName: string, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const r = getRedis();
  await r.connect().catch(() => {});
  const pipe = r.pipeline();
  for (const id of ids) {
    pipe.lrem(processingQueueName, 1, String(id));
  }
  await pipe.exec();
  logger.info({ queue: processingQueueName, count: ids.length }, 'Acknowledged queue batch');
}

export async function queueRecoverProcessing(queueName: string, processingQueueName: string): Promise<number> {
  const r = getRedis();
  await r.connect().catch(() => {});
  const script = `
    local moved = 0
    while true do
      local value = redis.call('rpop', KEYS[2])
      if not value then break end
      redis.call('lpush', KEYS[1], value)
      moved = moved + 1
    end
    return moved
  `;
  const moved = await r.eval(script, 2, queueName, processingQueueName) as number;
  if (moved > 0) {
    logger.warn({ queue: queueName, processingQueue: processingQueueName, moved }, 'Recovered unacked queue items');
  }
  return moved;
}

export async function queueLength(queueName: string): Promise<number> {
  const r = getRedis();
  await r.connect().catch(() => {});
  return r.llen(queueName);
}

export async function disconnectQueue(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => {});
    redis = null;
  }
}
