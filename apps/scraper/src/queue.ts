import { Queue } from 'bullmq';
import { config } from './config.js';

const connection = { url: config.redis.url };

export const scrapeQueue = new Queue('scrape', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },
});

export const processQueue = new Queue('process', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },
});

export const reclusterQueue = new Queue('recluster', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },
});
