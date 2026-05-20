import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, pool, schema } from '../lib/db.js';
import { logArticleDiscard } from '../lib/article-discard-log.js';
import { classifyTrashArticle } from '../lib/article-trash.js';
import { buildActivity } from '../lib/llm-usage.js';
import { analyzeArticle } from '../processors/summarizer.js';
import { logger } from '../logger.js';
import {
  queueAck,
  queueClaimBatch,
  queuePush,
  queueRecoverProcessing,
  disconnectQueue,
  QUEUE_PROCESS,
  QUEUE_PROCESSING_PROCESS,
  QUEUE_EMBED,
} from './queue.js';
import { triggerNextJob } from './trigger.js';

export async function main() {
  const startTime = Date.now();
  const { triggerMode } = config.pipeline;
  const concurrency = config.llm.concurrency;
  const activity = buildActivity(triggerMode, 'process', 'summarize');

  logger.info({ concurrency, triggerMode, provider: config.llm.provider, model: config.llm.model }, 'Process job started');

  await queueRecoverProcessing(QUEUE_PROCESS, QUEUE_PROCESSING_PROCESS);

  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalProcessed = 0;

  while (true) {
    const articleIds = await queueClaimBatch(
      QUEUE_PROCESS,
      QUEUE_PROCESSING_PROCESS,
      config.llm.batchSize,
    );

    if (articleIds.length === 0) {
      if (totalProcessed === 0) logger.info('No articles in process queue');
      break;
    }

    logger.info({ count: articleIds.length }, 'Processing article batch');

    const batchResult = await processBatch(articleIds, activity, concurrency);

    if (batchResult.toEmbed.length > 0) {
      await queuePush(QUEUE_EMBED, batchResult.toEmbed);
    }
    await queueAck(QUEUE_PROCESSING_PROCESS, articleIds);

    totalSucceeded += batchResult.succeeded;
    totalFailed += batchResult.failed;
    totalProcessed += articleIds.length;

    logger.info(
      { succeeded: totalSucceeded, failed: totalFailed, processed: totalProcessed },
      'Process progress',
    );
  }

  const durationMs = Date.now() - startTime;
  logger.info({ durationMs, succeeded: totalSucceeded, failed: totalFailed, processed: totalProcessed }, 'Process job finished');

  await triggerNextJob(totalProcessed);

  await disconnectQueue();
  await pool.end();
}

async function processBatch(
  articleIds: number[],
  activity: ReturnType<typeof buildActivity>,
  concurrency: number,
): Promise<{ toEmbed: number[]; succeeded: number; failed: number }> {
  const toEmbed: number[] = [];
  let succeeded = 0;
  let failed = 0;
  let active = 0;
  let idx = 0;

  await new Promise<void>((resolve) => {
    function next() {
      while (active < concurrency && idx < articleIds.length) {
        const articleId = articleIds[idx++];
        active++;

        processOne(articleId, activity)
          .then((result) => {
            if (result.toEmbed) toEmbed.push(articleId);
            if (result.succeeded) succeeded++;
            else failed++;
          })
          .catch((err) => {
            logger.error({ err, articleId }, 'Unexpected processOne failure');
            failed++;
          })
          .finally(() => {
            active--;
            if (idx >= articleIds.length && active === 0) resolve();
            else next();
          });
      }
    }
    next();
  });

  return { toEmbed, succeeded, failed };
}

async function processOne(
  articleId: number,
  activity: ReturnType<typeof buildActivity>,
): Promise<{ succeeded: boolean; toEmbed: boolean }> {
  const rows = await db
    .select({
      id: schema.articles.id,
      sourceId: schema.articles.sourceId,
      sourceSlug: schema.sources.slug,
      title: schema.articles.title,
      body: schema.articles.body,
      lead: schema.articles.lead,
      category: schema.articles.category,
      publishedAt: schema.articles.publishedAt,
      url: schema.articles.url,
    })
    .from(schema.articles)
    .innerJoin(schema.sources, eq(schema.articles.sourceId, schema.sources.id))
    .where(eq(schema.articles.id, articleId))
    .limit(1);

  if (rows.length === 0) {
    logger.warn({ articleId }, 'Article not found in DB');
    return { succeeded: false, toEmbed: false };
  }

  const article = rows[0];

  try {
    const analysis = await analyzeArticle(article.title, article.body, article.lead, activity);

    if (analysis) {
      await db
        .update(schema.articles)
        .set({
          summary: analysis.summary,
          mainEvent: analysis.mainEvent,
          storyIdentity: analysis.storyIdentity,
          articleType: analysis.articleType,
          location: analysis.location,
          entities: analysis.entities.length > 0 ? analysis.entities : null,
          topics: analysis.topics.length > 0 ? analysis.topics : null,
        })
        .where(eq(schema.articles.id, articleId));

      logger.info({ url: article.url, articleType: analysis.articleType }, 'Article analyzed');
      return { succeeded: true, toEmbed: true };
    } else {
      const classification = classifyTrashArticle({
        sourceSlug: article.sourceSlug,
        url: article.url,
        title: article.title,
        lead: article.lead,
        body: article.body,
        category: article.category,
        stage: 'analysis',
      });

      if (classification.action === 'discard') {
        await logArticleDiscard({
          sourceId: article.sourceId,
          sourceSlug: article.sourceSlug,
          url: article.url,
          title: article.title,
          category: article.category,
          reason: classification.reason,
          ruleId: classification.ruleId,
          confidence: classification.confidence,
          stage: 'analysis',
          publishedAt: article.publishedAt,
        });
        logger.info({ url: article.url, ruleId: classification.ruleId }, 'Article analysis classified as trash');
      }

      logger.warn({ url: article.url }, 'Article analysis returned null');
      return { succeeded: false, toEmbed: false };
    }
  } catch (err) {
    logger.error({ err, url: article.url }, 'Article analysis failed');
    return { succeeded: false, toEmbed: false };
  }
}

const isDirectRun = process.argv[1]?.includes('process-job');
if (isDirectRun) {
  main().catch((err) => {
    logger.fatal({ err }, 'Process job failed');
    process.exit(1);
  });
}
