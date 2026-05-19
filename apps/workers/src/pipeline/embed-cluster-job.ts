import { eq, inArray } from 'drizzle-orm';
import { truncateForEmbedding } from '@korkep/shared';
import { config } from '../config.js';
import { db, pool, schema } from '../lib/db.js';
import { buildActivity } from '../lib/llm-usage.js';
import { getEmbeddingsBatch } from '../processors/embedder.js';
import { assignStory } from '../processors/clusterer.js';
import { logger } from '../logger.js';
import {
  queueAck,
  queueClaimBatch,
  queueRecoverProcessing,
  disconnectQueue,
  QUEUE_EMBED,
  QUEUE_PROCESSING_EMBED,
} from './queue.js';

export async function main() {
  const startTime = Date.now();
  const { triggerMode } = config.pipeline;
  const activity = buildActivity(triggerMode, 'embed', 'embedding');

  logger.info({ triggerMode, model: config.embedding.model }, 'Embed+Cluster job started');

  await queueRecoverProcessing(QUEUE_EMBED, QUEUE_PROCESSING_EMBED);

  let embedded = 0;
  let clustered = 0;
  let errors = 0;
  let total = 0;

  while (true) {
    const articleIds = await queueClaimBatch(
      QUEUE_EMBED,
      QUEUE_PROCESSING_EMBED,
      config.embedding.batchSize,
    );

    if (articleIds.length === 0) {
      if (total === 0) logger.info('No articles in embed queue');
      break;
    }

    const result = await processBatch(articleIds, activity);
    await queueAck(QUEUE_PROCESSING_EMBED, articleIds);

    embedded += result.embedded;
    clustered += result.clustered;
    errors += result.errors;
    total += articleIds.length;

    logger.info({ embedded, clustered, errors, total }, 'Embed+Cluster progress');
  }

  const durationMs = Date.now() - startTime;
  logger.info({ durationMs, embedded, clustered, errors, total }, 'Embed+Cluster job finished');

  await disconnectQueue();
  await pool.end();
}

type EmbedArticle = {
  id: number;
  title: string;
  body: string | null;
  lead: string | null;
  summary: string | null;
  mainEvent: string | null;
  storyIdentity: string | null;
  articleType: string | null;
  location: string | null;
  entities: string[] | null;
  topics: string[] | null;
  category: string | null;
  publishedAt: Date | null;
  sourceId: number;
  url: string;
};

async function processBatch(
  articleIds: number[],
  activity: ReturnType<typeof buildActivity>,
): Promise<{ embedded: number; clustered: number; errors: number }> {
  const rows = await db
    .select({
      id: schema.articles.id,
      title: schema.articles.title,
      body: schema.articles.body,
      lead: schema.articles.lead,
      summary: schema.articles.summary,
      mainEvent: schema.articles.mainEvent,
      storyIdentity: schema.articles.storyIdentity,
      articleType: schema.articles.articleType,
      location: schema.articles.location,
      entities: schema.articles.entities,
      topics: schema.articles.topics,
      category: schema.articles.category,
      publishedAt: schema.articles.publishedAt,
      sourceId: schema.articles.sourceId,
      url: schema.articles.url,
    })
    .from(schema.articles)
    .where(inArray(schema.articles.id, articleIds));

  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = articleIds.map((id) => byId.get(id)).filter((row): row is EmbedArticle => row != null);
  const missing = articleIds.length - ordered.length;

  if (missing > 0) {
    logger.warn({ missing }, 'Some queued articles were not found in DB');
  }

  if (ordered.length === 0) {
    return { embedded: 0, clustered: 0, errors: missing };
  }

  const texts = ordered.map((article) =>
    truncateForEmbedding({
      title: article.title,
      body: article.body,
      publishedAt: article.publishedAt,
      summary: article.summary,
      lead: article.lead,
      category: article.category,
      mainEvent: article.mainEvent,
      storyIdentity: article.storyIdentity,
      articleType: article.articleType as any,
      location: article.location,
      entities: article.entities,
      topics: article.topics,
    }),
  );

  let embeddings: number[][];
  try {
    embeddings = await getEmbeddingsBatch(texts, activity);
  } catch (err) {
    logger.error({ err, count: ordered.length }, 'Embedding batch failed');
    return { embedded: 0, clustered: 0, errors: ordered.length + missing };
  }

  let embedded = 0;
  let clustered = 0;
  let errors = missing;

  const assignmentResults = await assignStoriesWithConcurrency(ordered, embeddings);

  for (let i = 0; i < ordered.length; i++) {
    const article = ordered[i];
    const result = assignmentResults[i];
    try {
      await db
        .update(schema.articles)
        .set({ embedding: embeddings[i], storyId: result.storyId })
        .where(eq(schema.articles.id, article.id));
      embedded++;
      if (result.storyId != null) clustered++;
      if (result.error) errors++;
      logger.info({ url: article.url, storyId: result.storyId, hasEmbedding: true }, 'Article embedded and clustered');
    } catch (err) {
      logger.error({ err, url: article.url }, 'Failed to store embedding/story assignment');
      errors++;
    }
  }

  return { embedded, clustered, errors };
}

async function assignStoriesWithConcurrency(
  articles: EmbedArticle[],
  embeddings: number[][],
): Promise<Array<{ storyId: number | null; error: boolean }>> {
  const results = new Array<{ storyId: number | null; error: boolean }>(articles.length);
  let running = 0;
  let next = 0;

  await new Promise<void>((resolve) => {
    function launch() {
      while (running < config.embedding.storyConcurrency && next < articles.length) {
        const index = next++;
        running++;

        (async () => {
          const article = articles[index];
          if (article.articleType === 'aggregation') {
            results[index] = { storyId: null, error: false };
            return;
          }

          try {
            const storyId = await assignStory(
              article.summary ?? article.title,
              embeddings[index],
              article.sourceId,
              article.entities,
            );
            results[index] = { storyId, error: false };
          } catch (err) {
            logger.error({ err, url: article.url }, 'Clustering failed, storing without story');
            results[index] = { storyId: null, error: true };
          }
        })()
          .finally(() => {
            running--;
            if (next >= articles.length && running === 0) resolve();
            else launch();
          });
      }
    }
    launch();
  });

  return results;
}

const isDirectRun = process.argv[1]?.includes('embed-cluster-job');
if (isDirectRun) {
  main().catch((err) => {
    logger.fatal({ err }, 'Embed+Cluster job failed');
    process.exit(1);
  });
}
