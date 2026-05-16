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
      articleType: schema.articles.articleType,
      publishedAt: schema.articles.publishedAt,
      createdAt: schema.articles.createdAt,
    })
    .from(schema.articles)
    .where(gt(schema.articles.createdAt, cutoff));

  // Exclude aggregation articles from clustering — they span multiple stories
  const withEmbeddings = articles.filter((a) => a.embedding != null && a.articleType !== 'aggregation');

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

  // Prepare all cluster metadata
  interface ClusterData {
    articleIds: number[];
    sourceIds: Set<number>;
    biasGroups: Set<string>;
    firstSeenAt: Date;
    relevanceScore: number;
    storyTopics: string[];
    clusterFingerprint: string;
    clusterArticles: typeof withEmbeddings;
  }

  const clusters: ClusterData[] = [];
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
    const relevanceScore = computeRelevanceScore(sourceIds.size, articleIds.length, biasGroups.size);
    const storyTopics = aggregateTopics(clusterArticles.map((a) => a.topics));
    const clusterFingerprint = articleIds.slice().sort((a, b) => a - b).join(',');

    clusters.push({ articleIds, sourceIds, biasGroups, firstSeenAt, relevanceScore, storyTopics, clusterFingerprint, clusterArticles });
  }

  // Generate titles and summaries in parallel via OpenRouter
  const LLM_CONCURRENCY = 15;
  const storyResults: Array<{ title: string; summary: string | null }> = new Array(clusters.length);

  let running = 0;
  let next = 0;

  await new Promise<void>((resolve) => {
    let settled = false;

    function launch() {
      while (running < LLM_CONCURRENCY && next < clusters.length) {
        const idx = next++;
        running++;
        const cluster = clusters[idx];

        (async () => {
          const cached = storyFingerprints.get(cluster.clusterFingerprint);
          if (cached) {
            storyResults[idx] = { title: cached.title, summary: cached.summary };
            logger.info({ storyTitle: cached.title, articleCount: cluster.articleIds.length }, 'Reused cached story title/summary');
            return;
          }

          const articleTitles = cluster.clusterArticles.map((a) => a.title);
          let storyTitle = cluster.clusterArticles[0].title;
          if (cluster.articleIds.length >= 2) {
            const generatedTitle = await generateStoryTitle(articleTitles);
            if (generatedTitle) {
              storyTitle = generatedTitle;
              logger.info({ storyTitle, articleCount: cluster.articleIds.length }, 'Generated story title');
            }
          }

          const articleSummaries = cluster.clusterArticles
            .map((a) => a.summary)
            .filter((s): s is string => s != null);
          const storySummary = await generateStorySummary(articleSummaries, storyTitle);

          storyResults[idx] = { title: storyTitle, summary: storySummary };
        })()
          .catch((err) => {
            logger.error({ err, articleCount: cluster.articleIds.length }, 'Story title/summary generation failed');
            storyResults[idx] = { title: cluster.clusterArticles[0].title, summary: null };
          })
          .finally(() => {
            running--;
            if (next >= clusters.length && running === 0 && !settled) {
              settled = true;
              resolve();
            } else {
              launch();
            }
          });
      }
    }

    launch();
    if (clusters.length === 0 && !settled) { settled = true; resolve(); }
  });

  logger.info({ total: clusters.length }, 'Story title/summary generation complete');

  // Write all stories and assign articles to DB
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const { title, summary } = storyResults[i];

    const [newStory] = await db
      .insert(schema.stories)
      .values({
        title,
        summary,
        topics: cluster.storyTopics.length > 0 ? cluster.storyTopics : null,
        articleCount: cluster.articleIds.length,
        sourceCount: cluster.sourceIds.size,
        relevanceScore: cluster.relevanceScore,
        firstSeenAt: cluster.firstSeenAt,
      })
      .returning({ id: schema.stories.id });

    await db
      .update(schema.articles)
      .set({ storyId: newStory.id })
      .where(inArray(schema.articles.id, cluster.articleIds));
  }

  logger.info(
    { stories: clusters.length, articles: withEmbeddings.length },
    'Recluster complete',
  );
}
