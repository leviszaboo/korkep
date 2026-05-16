import { isNull, eq, asc } from 'drizzle-orm';
import { truncateForEmbedding } from '@korkep/shared';
import { db, schema } from '../lib/db.js';
import { getEmbeddingsBatch } from '../processors/embedder.js';
import { analyzeArticle } from '../processors/summarizer.js';
import { assignStory } from '../processors/clusterer.js';
import { logger } from '../logger.js';

const BATCH_SIZE = 50;
const DB_CONCURRENCY = 10;
const ANALYSIS_CONCURRENCY = 15;

interface BackfillRow {
  id: number;
  title: string;
  body: string | null;
  lead: string | null;
  summary: string | null;
  mainEvent: string | null;
  location: string | null;
  entities: string[] | null;
  topics: string[] | null;
  category: string | null;
  url: string;
  sourceId: number;
  publishedAt: Date | null;
}

async function analyzeBatch(rows: BackfillRow[]): Promise<void> {
  const needsAnalysis = rows.filter((r) => !r.summary);
  if (needsAnalysis.length === 0) return;

  logger.info({ count: needsAnalysis.length }, 'Analyzing articles in batch');

  let running = 0;
  let next = 0;

  await new Promise<void>((resolve) => {
    let settled = false;

    function launch() {
      while (running < ANALYSIS_CONCURRENCY && next < needsAnalysis.length) {
        const i = next++;
        running++;

        const article = needsAnalysis[i];
        analyzeArticle(article.title, article.body, article.lead)
          .then((result) => {
            if (result) {
              article.summary = result.summary;
              article.mainEvent = result.mainEvent;
              article.location = result.location;
              article.entities = result.entities.length > 0 ? result.entities : null;
              article.topics = result.topics.length > 0 ? result.topics : null;

              db.update(schema.articles)
                .set({
                  summary: result.summary,
                  mainEvent: result.mainEvent,
                  location: result.location,
                  entities: article.entities,
                  topics: article.topics,
                })
                .where(eq(schema.articles.id, article.id))
                .then(() => {
                  logger.debug({ url: article.url }, 'Backfill analysis stored');
                })
                .catch((err) => {
                  logger.error({ err, url: article.url }, 'Failed to store backfill analysis');
                });
            }
          })
          .catch((err) => {
            logger.warn({ err, url: article.url }, 'Backfill analysis failed, skipping');
          })
          .finally(() => {
            running--;
            if (next >= needsAnalysis.length && running === 0 && !settled) {
              settled = true;
              resolve();
            } else {
              launch();
            }
          });
      }
    }

    launch();
    if (needsAnalysis.length === 0 && !settled) {
      settled = true;
      resolve();
    }
  });
}

async function processArticles(
    rows: BackfillRow[],
    embeddings: number[][],
): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    let running = 0;
    let next = 0;

    await new Promise<void>((resolve, reject) => {
        let settled = false;

        function launch() {
            while (running < DB_CONCURRENCY && next < rows.length) {
                const i = next++;
                running++;

                (async () => {
                    const article = rows[i];
                    const embedding = embeddings[i];
                    let storyId: number | null = null;
                    try {
                        storyId = await assignStory(article.title, embedding, article.sourceId);
                    } catch (err) {
                        logger.error({ err, url: article.url }, 'Clustering failed during backfill');
                    }
                    await db
                        .update(schema.articles)
                        .set({ embedding, storyId })
                        .where(eq(schema.articles.id, article.id));
                    processed++;
                    logger.info({ url: article.url, storyId, progress: processed }, 'Backfilled article');
                })()
                    .then(() => {
                        running--;
                        if (next >= rows.length && running === 0 && !settled) {
                            settled = true;
                            resolve();
                        } else {
                            launch();
                        }
                    })
                    .catch((err) => {
                        failed++;
                        running--;
                        logger.error({ err, url: rows[i].url }, 'Failed to backfill article');
                        if (next >= rows.length && running === 0 && !settled) {
                            settled = true;
                            resolve();
                        } else {
                            launch();
                        }
                    });
            }
        }

        launch();
        if (rows.length === 0 && !settled) {
            settled = true;
            resolve();
        }
    });

    return { processed, failed };
}

export async function runBackfill() {
    logger.info('Starting embedding backfill (with analysis)');

    let totalProcessed = 0;
    let totalFailed = 0;

    while (true) {
        const rows = await db
            .select({
                id: schema.articles.id,
                title: schema.articles.title,
                body: schema.articles.body,
                lead: schema.articles.lead,
                summary: schema.articles.summary,
                mainEvent: schema.articles.mainEvent,
                location: schema.articles.location,
                entities: schema.articles.entities,
                topics: schema.articles.topics,
                category: schema.articles.category,
                url: schema.articles.url,
                sourceId: schema.articles.sourceId,
                publishedAt: schema.articles.publishedAt,
            })
            .from(schema.articles)
            .where(isNull(schema.articles.embedding))
            .orderBy(asc(schema.articles.createdAt))
            .limit(BATCH_SIZE);

        if (rows.length === 0) break;

        // Step 1: Analyze articles that don't have structured data yet
        await analyzeBatch(rows);

        // Step 2: Generate embeddings using structured fields
        const texts = rows.map((a) =>
          truncateForEmbedding({
            title: a.title,
            body: a.body,
            publishedAt: a.publishedAt,
            summary: a.summary,
            lead: a.lead,
            category: a.category,
            mainEvent: a.mainEvent,
            location: a.location,
            entities: a.entities,
            topics: a.topics,
          }),
        );

        let embeddings: number[][];
        try {
            embeddings = await getEmbeddingsBatch(texts);
        } catch (err) {
            totalFailed += rows.length;
            logger.error({ err, count: rows.length }, 'Batch embedding failed, skipping batch');
            continue;
        }

        // Step 3: Assign to stories and store
        const { processed, failed } = await processArticles(rows, embeddings);
        totalProcessed += processed;
        totalFailed += failed;

        logger.info({ totalProcessed, totalFailed, batchSize: rows.length }, 'Batch complete');
    }

    logger.info({ totalProcessed, totalFailed }, 'Backfill complete');
}

export async function runFullRecluster() {
    logger.info('Starting full re-embed and recluster');

    await db.update(schema.articles).set({ storyId: null, embedding: null });
    await db.delete(schema.stories);
    logger.info('Cleared all stories and embeddings');

    await runBackfill();
    logger.info('Full recluster complete');
}
