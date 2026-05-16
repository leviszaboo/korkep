import { gt, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../lib/db.js';
import { config } from '../config.js';
import { CLUSTERING } from '@korkep/shared';
import { generateStoryTitle, generateStorySummary } from '../processors/summarizer.js';
import { logger } from '../logger.js';

interface ReclusterResultItem {
  id: number;
  cluster: number;
}

interface ReclusterResponse {
  results: ReclusterResultItem[];
  num_clusters: number;
}

function normalizeBiasGroup(biasRating: string): string {
  if (biasRating === 'left' || biasRating === 'center-left') return 'left';
  if (biasRating === 'right' || biasRating === 'center-right') return 'right';
  return 'center';
}

function computeRelevanceScore(
  sourceCount: number,
  articleCount: number,
  biasGroupCount: number,
): number {
  const sourceFactor = sourceCount * 3.0;
  const articleFactor = articleCount * 1.0;
  const diversityBonus = biasGroupCount >= 3 ? 15.0 : biasGroupCount >= 2 ? 8.0 : 0;
  return sourceFactor + articleFactor + diversityBonus;
}

function aggregateTopics(articleTopics: (string[] | null)[]): string[] {
  const counts = new Map<string, number>();
  for (const topics of articleTopics) {
    if (!topics) continue;
    for (const t of topics) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic]) => topic);
}

export async function runRecluster() {
  const cutoff = new Date(Date.now() - CLUSTERING.timeWindowHours * 60 * 60 * 1000);

  const articles = await db
    .select({
      id: schema.articles.id,
      title: schema.articles.title,
      summary: schema.articles.summary,
      topics: schema.articles.topics,
      sourceId: schema.articles.sourceId,
      embedding: schema.articles.embedding,
      publishedAt: schema.articles.publishedAt,
      createdAt: schema.articles.createdAt,
    })
    .from(schema.articles)
    .where(gt(schema.articles.createdAt, cutoff));

  const withEmbeddings = articles.filter((a) => a.embedding != null);

  if (withEmbeddings.length < 2) {
    logger.info('Not enough articles with embeddings to recluster');
    return;
  }

  const sourceRows = await db
    .select({ id: schema.sources.id, biasRating: schema.sources.biasRating })
    .from(schema.sources);
  const sourceBiasMap = new Map(sourceRows.map((s) => [s.id, s.biasRating]));

  const now = Date.now();
  const items = withEmbeddings.map((a) => {
    const ts = a.publishedAt ?? a.createdAt;
    const hoursAgo = (now - new Date(ts).getTime()) / 3_600_000;
    return {
      id: a.id,
      embedding: a.embedding!,
      timestamp_hours: hoursAgo,
    };
  });

  logger.info({ count: items.length }, 'Sending articles to HDBSCAN recluster');

  const res = await fetch(`${config.clusterer.url}/recluster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, min_cluster_size: 2 }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    throw new Error(`Recluster returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as ReclusterResponse;
  logger.info({ numClusters: data.num_clusters }, 'HDBSCAN clustering complete');

  const articleMap = new Map(withEmbeddings.map((a) => [a.id, a]));

  const clusterGroups = new Map<number, number[]>();
  for (const result of data.results) {
    if (result.cluster < 0) {
      clusterGroups.set(-result.id, [result.id]);
      continue;
    }
    const group = clusterGroups.get(result.cluster) ?? [];
    group.push(result.id);
    clusterGroups.set(result.cluster, group);
  }

  // Snapshot existing clusters so we can skip LLM calls for unchanged ones
  const existingStories = await db
    .select({
      id: schema.stories.id,
      title: schema.stories.title,
      summary: schema.stories.summary,
    })
    .from(schema.stories);

  const existingArticlesByStory = await db
    .select({ storyId: schema.articles.storyId, articleId: schema.articles.id })
    .from(schema.articles)
    .where(sql`${schema.articles.storyId} IS NOT NULL`);

  const storyFingerprints = new Map<string, { title: string; summary: string | null }>();
  const storyArticleMap = new Map<number, number[]>();
  for (const row of existingArticlesByStory) {
    const group = storyArticleMap.get(row.storyId!) ?? [];
    group.push(row.articleId);
    storyArticleMap.set(row.storyId!, group);
  }
  for (const story of existingStories) {
    const ids = storyArticleMap.get(story.id);
    if (ids) {
      const fingerprint = ids.sort((a, b) => a - b).join(',');
      storyFingerprints.set(fingerprint, { title: story.title, summary: story.summary });
    }
  }

  await db.update(schema.articles).set({ storyId: null });
  await db.delete(schema.stories);

  for (const [, articleIds] of clusterGroups) {
    const clusterArticles = articleIds.map((id) => articleMap.get(id)!);
    const sourceIds = new Set(clusterArticles.map((a) => a.sourceId));
    const biasGroups = new Set(
      [...sourceIds].map((sid) => normalizeBiasGroup(sourceBiasMap.get(sid) ?? 'center')),
    );

    const firstSeenAt = clusterArticles.reduce((earliest, a) => {
      const ts = a.publishedAt ?? a.createdAt;
      return ts < earliest ? ts : earliest;
    }, clusterArticles[0].publishedAt ?? clusterArticles[0].createdAt);

    const relevanceScore = computeRelevanceScore(
      sourceIds.size,
      articleIds.length,
      biasGroups.size,
    );

    // Check if this exact cluster existed before — skip LLM calls if so
    const clusterFingerprint = articleIds.slice().sort((a, b) => a - b).join(',');
    const cached = storyFingerprints.get(clusterFingerprint);

    let storyTitle: string;
    let storySummary: string | null;

    if (cached) {
      storyTitle = cached.title;
      storySummary = cached.summary;
      logger.info({ storyTitle, articleCount: articleIds.length }, 'Reused cached story title/summary');
    } else {
      const articleTitles = clusterArticles.map((a) => a.title);
      storyTitle = clusterArticles[0].title;
      if (articleIds.length >= 2) {
        const generatedTitle = await generateStoryTitle(articleTitles);
        if (generatedTitle) {
          storyTitle = generatedTitle;
          logger.info({ storyTitle, articleCount: articleIds.length }, 'Generated story title');
        } else {
          logger.warn({ fallbackTitle: storyTitle, articleCount: articleIds.length }, 'Story title generation returned null, using first article title');
        }
      }

      const articleSummaries = clusterArticles
        .map((a) => a.summary)
        .filter((s): s is string => s != null);
      storySummary = await generateStorySummary(articleSummaries, storyTitle);
      if (storySummary) {
        logger.info({ storyTitle, summaryLength: storySummary.length }, 'Generated story summary');
      } else {
        logger.warn({ storyTitle }, 'Story summary generation returned null');
      }
    }

    // Aggregate topics from articles (majority vote)
    const storyTopics = aggregateTopics(clusterArticles.map((a) => a.topics));

    const [newStory] = await db
      .insert(schema.stories)
      .values({
        title: storyTitle,
        summary: storySummary,
        topics: storyTopics.length > 0 ? storyTopics : null,
        articleCount: articleIds.length,
        sourceCount: sourceIds.size,
        relevanceScore,
        firstSeenAt,
      })
      .returning({ id: schema.stories.id });

    await db
      .update(schema.articles)
      .set({ storyId: newStory.id })
      .where(inArray(schema.articles.id, articleIds));
  }

  logger.info(
    { stories: clusterGroups.size, articles: withEmbeddings.length },
    'Recluster complete',
  );
}
