import { eq, gt } from 'drizzle-orm';
import { db, pool, schema } from './lib/db.js';
import { analyzeArticleViaOpenRouter, generateStoryTitle, generateStorySummary } from './processors/summarizer.js';
import { logger } from './logger.js';

const CONCURRENCY = 15;
const SINCE_HOURS = Number(process.env.SINCE_HOURS) || 24;

async function resummarizeArticles() {
  const cutoff = new Date(Date.now() - SINCE_HOURS * 60 * 60 * 1000);
  logger.info({ sinceHours: SINCE_HOURS, cutoff: cutoff.toISOString() }, 'Starting resummarize');

  const articles = await db
    .select({
      id: schema.articles.id,
      title: schema.articles.title,
      body: schema.articles.body,
      lead: schema.articles.lead,
      url: schema.articles.url,
      storyId: schema.articles.storyId,
    })
    .from(schema.articles)
    .where(gt(schema.articles.createdAt, cutoff));

  logger.info({ count: articles.length }, 'Articles to resummarize');
  if (articles.length === 0) return;

  let updated = 0;
  let failed = 0;
  let running = 0;
  let next = 0;
  const affectedStoryIds = new Set<number>();

  await new Promise<void>((resolve) => {
    function launch() {
      while (running < CONCURRENCY && next < articles.length) {
        const i = next++;
        running++;
        const article = articles[i];

        analyzeArticleViaOpenRouter(article.title, article.body, article.lead)
          .then(async (result) => {
            if (result) {
              await db
                .update(schema.articles)
                .set({
                  summary: result.summary,
                  mainEvent: result.mainEvent,
                  location: result.location,
                  entities: result.entities.length > 0 ? result.entities : null,
                  topics: result.topics.length > 0 ? result.topics : null,
                })
                .where(eq(schema.articles.id, article.id));
              updated++;
              if (article.storyId) affectedStoryIds.add(article.storyId);
              logger.info({ url: article.url, progress: `${updated + failed}/${articles.length}` }, 'Resummarized');
            } else {
              failed++;
            }
          })
          .catch((err) => {
            failed++;
            logger.warn({ err, url: article.url }, 'Resummarize failed for article');
          })
          .finally(() => {
            running--;
            if (next >= articles.length && running === 0) {
              resolve();
            } else {
              launch();
            }
          });
      }
    }
    launch();
  });

  logger.info({ updated, failed }, 'Article resummarization complete');
  return affectedStoryIds;
}

const STORY_CONCURRENCY = 15;

async function resummarizeStories(storyIds: Set<number>) {
  if (storyIds.size === 0) return;

  const ids = [...storyIds];
  logger.info({ count: ids.length }, 'Regenerating story titles and summaries');

  let completed = 0;
  let running = 0;
  let next = 0;

  await new Promise<void>((resolve) => {
    function launch() {
      while (running < STORY_CONCURRENCY && next < ids.length) {
        const storyId = ids[next++];
        running++;

        resummarizeOneStory(storyId)
          .then(() => { completed++; })
          .catch((err) => {
            logger.error({ err, storyId }, 'Failed to resummarize story');
          })
          .finally(() => {
            running--;
            if (next >= ids.length && running === 0) {
              resolve();
            } else {
              launch();
            }
          });
      }
    }
    launch();
  });

  logger.info({ completed, total: ids.length }, 'Story resummarization complete');
}

async function resummarizeOneStory(storyId: number) {
  const storyArticles = await db
    .select({
      title: schema.articles.title,
      summary: schema.articles.summary,
      topics: schema.articles.topics,
    })
    .from(schema.articles)
    .where(eq(schema.articles.storyId, storyId));

  if (storyArticles.length === 0) return;

  const titles = storyArticles.map((a) => a.title);
  const summaries = storyArticles.map((a) => a.summary).filter((s): s is string => s != null);

  const newTitle = storyArticles.length >= 2
    ? await generateStoryTitle(titles)
    : null;

  const topicCounts = new Map<string, number>();
  for (const a of storyArticles) {
    if (!a.topics) continue;
    for (const t of a.topics) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
  }
  const storyTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  const titleForSummary = newTitle ?? titles[0];
  const newSummary = await generateStorySummary(summaries, titleForSummary);

  const updates: Record<string, unknown> = {};
  if (newTitle) updates.title = newTitle;
  if (newSummary) updates.summary = newSummary;
  if (storyTopics.length > 0) updates.topics = storyTopics;

  if (Object.keys(updates).length > 0) {
    await db
      .update(schema.stories)
      .set(updates)
      .where(eq(schema.stories.id, storyId));
    logger.info({ storyId, newTitle: newTitle ?? '(kept)', summaryLen: newSummary?.length }, 'Story updated');
  }
}

async function main() {
  const affectedStoryIds = await resummarizeArticles();
  if (affectedStoryIds && affectedStoryIds.size > 0) {
    await resummarizeStories(affectedStoryIds);
  }

  await pool.end();
  logger.info('Resummarize finished');
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, 'Resummarize failed');
  process.exit(1);
});
