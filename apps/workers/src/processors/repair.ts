import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { truncateForEmbedding } from '@korkep/shared';
import { db, schema } from '../lib/db.js';
import { config } from '../config.js';
import { getEmbeddingsBatch } from '../processors/embedder.js';
import { analyzeArticle, generateStoryTitleAndSummary, type StoryTitleResult } from '../processors/summarizer.js';
import type { LlmActivity } from '../lib/llm-usage.js';
import { validateImageUrl, type ImageValidationResult } from '../lib/image-url.js';
import { logger } from '../logger.js';

const ANALYSIS_CONCURRENCY = config.repair.analysisConcurrency;
const LOOKBACK_HOURS = config.repair.lookbackHours;
const MAX_ARTICLES = config.repair.maxArticles;
const MAX_STORIES = config.repair.maxStories;
const EMBEDDING_BATCH_SIZE = config.repair.embeddingBatchSize;
const GRACE_MINUTES = config.repair.graceMinutes;

type RepairableArticleShape = {
  summary: string | null;
  embedding: number[] | null;
};

type RepairableStoryShape = {
  summary: string | null;
};

type ImageRepairCandidate = {
  id: number;
  imageUrl: string | null;
  sourceSlug: string;
};

type ImageValidator = (url: string, sourceSlug: string) => Promise<ImageValidationResult>;

const BROKEN_TEXT_VALUES = new Set(['n/a', 'null', 'undefined']);

export function isBrokenText(value: string | null | undefined): boolean {
  if (value == null) return true;
  const normalized = value.trim();
  if (normalized.length === 0) return true;
  return BROKEN_TEXT_VALUES.has(normalized.toLowerCase());
}

export function articleNeedsRepair(article: RepairableArticleShape): boolean {
  return isBrokenText(article.summary) || article.embedding == null;
}

export function storyNeedsSummaryRepair(story: RepairableStoryShape): boolean {
  return isBrokenText(story.summary);
}

export function shouldRepairStorySummary(story: RepairableStoryShape & { articleCount: number }): boolean {
  return story.articleCount >= 2 && storyNeedsSummaryRepair(story);
}

export function capRepairCandidates<T>(candidates: T[], max: number): T[] {
  if (max <= 0) return [];
  return candidates.slice(0, max);
}

export function getRepairWindow(
  now: Date,
  lookbackHours: number,
  graceMinutes: number,
): { oldest: Date; newest: Date } {
  return {
    oldest: new Date(now.getTime() - lookbackHours * 60 * 60 * 1000),
    newest: new Date(now.getTime() - graceMinutes * 60 * 1000),
  };
}

export function storySummaryUpdateFromResult(
  result: StoryTitleResult | null,
): { title: string; summary: string } | null {
  if (!result || result.coherent !== true) return null;
  const summary = result.summary?.trim();
  if (summary == null || isBrokenText(summary)) return null;
  return { title: result.title, summary };
}

export async function invalidImageArticleIds(
  candidates: ImageRepairCandidate[],
  validator: ImageValidator = (url, sourceSlug) => validateImageUrl(url, { sourceSlug }),
): Promise<number[]> {
  const invalidIds: number[] = [];

  for (const candidate of candidates) {
    if (!candidate.imageUrl) continue;
    const result = await validator(candidate.imageUrl, candidate.sourceSlug);
    if (!result.ok) invalidIds.push(candidate.id);
  }

  return invalidIds;
}

export async function runRepair(activity: LlmActivity) {
  const repairWindow = getRepairWindow(new Date(), LOOKBACK_HOURS, GRACE_MINUTES);

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
      and(
        gt(schema.articles.createdAt, repairWindow.oldest),
        lte(schema.articles.createdAt, repairWindow.newest),
        or(
          isNull(schema.articles.summary),
          eq(sql`btrim(${schema.articles.summary})`, ''),
          isNull(schema.articles.embedding),
        ),
      ),
    )
    .orderBy(desc(schema.articles.createdAt))
    .limit(MAX_ARTICLES);

  const needsWork = capRepairCandidates(broken.filter(articleNeedsRepair), MAX_ARTICLES);

  if (needsWork.length === 0) {
    logger.info('Repair: all recent articles have summary and embedding');
  }

  const needsSummary = needsWork.filter((a) => isBrokenText(a.summary));
  const needsEmbedding = needsWork.filter((a) => a.embedding == null);
  logger.info(
    {
      lookbackHours: LOOKBACK_HOURS,
      graceMinutes: GRACE_MINUTES,
      maxArticles: MAX_ARTICLES,
      selectedArticles: needsWork.length,
      needsSummary: needsSummary.length,
      needsEmbedding: needsEmbedding.length,
    },
    'Repair: found article candidates',
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

  const toEmbed = needsWork.filter((a) => a.embedding == null && !isBrokenText(a.summary));
  if (toEmbed.length > 0) {
    for (let i = 0; i < toEmbed.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + EMBEDDING_BATCH_SIZE);
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

  const stillMissing = needsWork.filter((a) => isBrokenText(a.summary)).length;
  await repairArticleImages(repairWindow);
  await repairStories(activity, repairWindow);

  logger.info(
    { repaired: needsWork.length - stillMissing, stillMissing },
    'Repair complete',
  );
}

async function repairArticleImages(
  repairWindow: { oldest: Date; newest: Date },
): Promise<void> {
  const imageCandidates = await db
    .select({
      id: schema.articles.id,
      imageUrl: schema.articles.imageUrl,
      sourceSlug: schema.sources.slug,
    })
    .from(schema.articles)
    .innerJoin(schema.sources, eq(schema.articles.sourceId, schema.sources.id))
    .where(
      and(
        gt(schema.articles.createdAt, repairWindow.oldest),
        lte(schema.articles.createdAt, repairWindow.newest),
        isNotNull(schema.articles.imageUrl),
      ),
    )
    .orderBy(desc(schema.articles.createdAt))
    .limit(MAX_ARTICLES);

  const invalidIds = await invalidImageArticleIds(imageCandidates);
  if (invalidIds.length === 0) {
    logger.info({ checked: imageCandidates.length }, 'Repair: article image validation pass done');
    return;
  }

  await db
    .update(schema.articles)
    .set({ imageUrl: null })
    .where(inArray(schema.articles.id, invalidIds));

  logger.info(
    { checked: imageCandidates.length, invalid: invalidIds.length },
    'Repair: cleared invalid article image URLs',
  );
}

async function repairStories(
  activity: LlmActivity,
  repairWindow: { oldest: Date; newest: Date },
): Promise<void> {
  const storyCandidates = await db
    .select({
      id: schema.stories.id,
      title: schema.stories.title,
      summary: schema.stories.summary,
      articleCount: schema.stories.articleCount,
      updatedAt: schema.stories.updatedAt,
    })
    .from(schema.stories)
    .where(
      and(
        gt(schema.stories.updatedAt, repairWindow.oldest),
        lte(schema.stories.updatedAt, repairWindow.newest),
        or(
          isNull(schema.stories.summary),
          eq(sql`btrim(${schema.stories.summary})`, ''),
        ),
      ),
    )
    .orderBy(desc(schema.stories.updatedAt))
    .limit(MAX_STORIES);

  const storiesToRepair = capRepairCandidates(
    storyCandidates.filter(shouldRepairStorySummary),
    MAX_STORIES,
  );

  logger.info(
    {
      lookbackHours: LOOKBACK_HOURS,
      graceMinutes: GRACE_MINUTES,
      maxStories: MAX_STORIES,
      selectedStories: storiesToRepair.length,
    },
    'Repair: found story summary candidates',
  );

  let repaired = 0;
  let failed = 0;
  let skipped = 0;

  for (const story of storiesToRepair) {
    try {
      const storyArticles = await db
        .select({
          id: schema.articles.id,
          title: schema.articles.title,
          summary: schema.articles.summary,
        })
        .from(schema.articles)
        .where(eq(schema.articles.storyId, story.id));

      if (storyArticles.length === 0) {
        failed++;
        logger.warn({ storyId: story.id }, 'Repair: story has no articles');
        continue;
      }

      if (storyArticles.length < 2) {
        skipped++;
        logger.info(
          { storyId: story.id, articleCount: storyArticles.length },
          'Repair: skipping single-article story summary',
        );
        continue;
      }

      const result = await generateStoryTitleAndSummary(
        storyArticles.map((a) => ({ id: a.id, title: a.title, summary: a.summary })),
        activity,
      );
      const update = storySummaryUpdateFromResult(result);

      if (!update) {
        failed++;
        logger.warn({ storyId: story.id }, 'Repair: story summary generation returned no usable summary');
        continue;
      }

      await db
        .update(schema.stories)
        .set(update)
        .where(eq(schema.stories.id, story.id));
      repaired++;
    } catch (err) {
      failed++;
      logger.warn({ err, storyId: story.id }, 'Repair: story summary repair failed');
    }
  }

  logger.info({ repaired, failed, skipped, total: storiesToRepair.length }, 'Repair: story summary pass done');
}
