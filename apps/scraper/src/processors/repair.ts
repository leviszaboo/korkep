import { gt, isNull, or, eq } from 'drizzle-orm';
import { truncateForEmbedding } from '@korkep/shared';
import { db, schema } from '../lib/db.js';
import { config } from '../config.js';
import { getEmbeddingsBatch } from '../processors/embedder.js';
import { analyzeArticle, analyzeArticleViaOpenRouter } from '../processors/summarizer.js';
import type { LlmActivity } from '../lib/llm-usage.js';
import { logger } from '../logger.js';

const BATCH_SIZE = 50;
const ANALYSIS_CONCURRENCY = config.repair.analysisConcurrency;
const LOOKBACK_HOURS = 24;

export async function runRepair(activity: LlmActivity = 'scheduled_repair') {
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const broken = await db
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
      embedding: schema.articles.embedding,
      url: schema.articles.url,
      sourceId: schema.articles.sourceId,
      publishedAt: schema.articles.publishedAt,
    })
    .from(schema.articles)
    .where(
      gt(schema.articles.createdAt, cutoff),
    );

  const needsWork = broken.filter((a) => !a.summary || !a.embedding);

  if (needsWork.length === 0) {
    logger.info('Repair: all recent articles have summary and embedding');
    return;
  }

  const needsSummary = needsWork.filter((a) => !a.summary);
  const needsEmbedding = needsWork.filter((a) => !a.embedding);
  logger.info(
    { needsSummary: needsSummary.length, needsEmbedding: needsEmbedding.length },
    'Repair: found articles needing fix',
  );

  if (needsSummary.length > 0) {
    let completed = 0;
    let running = 0;
    let next = 0;

    await new Promise<void>((resolve) => {
      let settled = false;

      function launch() {
        while (running < ANALYSIS_CONCURRENCY && next < needsSummary.length) {
          const i = next++;
          running++;
          const article = needsSummary[i];

          analyzeArticle(article.title, article.body, article.lead, activity)
            .then(async (result) => {
              if (result) {
                await db
                  .update(schema.articles)
                  .set({
                    summary: result.summary,
                    mainEvent: result.mainEvent,
                    storyIdentity: result.storyIdentity,
                    articleType: result.articleType,
                    location: result.location,
                    entities: result.entities.length > 0 ? result.entities : null,
                    topics: result.topics.length > 0 ? result.topics : null,
                  })
                  .where(eq(schema.articles.id, article.id));
                article.summary = result.summary;
                article.mainEvent = result.mainEvent;
                article.storyIdentity = result.storyIdentity;
                article.articleType = result.articleType;
                article.location = result.location;
                article.entities = result.entities.length > 0 ? result.entities : null;
                article.topics = result.topics.length > 0 ? result.topics : null;
                completed++;
              }
            })
            .catch((err) => {
              logger.warn({ err, url: article.url }, 'Repair: analysis failed');
            })
            .finally(() => {
              running--;
              if (next >= needsSummary.length && running === 0 && !settled) {
                settled = true;
                resolve();
              } else {
                launch();
              }
            });
        }
      }

      launch();
      if (needsSummary.length === 0 && !settled) { settled = true; resolve(); }
    });

    logger.info({ completed, total: needsSummary.length }, 'Repair: summarization pass done');
  }

  const toEmbed = needsWork.filter((a) => !a.embedding && a.summary);
  if (toEmbed.length > 0) {
    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      const texts = batch.map((a) =>
        truncateForEmbedding({
          title: a.title,
          body: a.body,
          publishedAt: a.publishedAt,
          summary: a.summary,
          lead: a.lead,
          category: a.category,
          mainEvent: a.mainEvent,
          storyIdentity: a.storyIdentity,
          articleType: a.articleType as any,
          location: a.location,
          entities: a.entities,
          topics: a.topics,
        }),
      );

      try {
        const embeddings = await getEmbeddingsBatch(texts, activity);
        for (let j = 0; j < batch.length; j++) {
          await db
            .update(schema.articles)
            .set({ embedding: embeddings[j] })
            .where(eq(schema.articles.id, batch[j].id));
        }
        logger.info({ count: batch.length }, 'Repair: embedded batch');
      } catch (err) {
        logger.error({ err, count: batch.length }, 'Repair: embedding batch failed');
      }
    }
  }

  const stillMissing = needsWork.filter((a) => !a.summary).length;
  logger.info(
    { repaired: needsWork.length - stillMissing, stillMissing },
    'Repair complete',
  );
}
