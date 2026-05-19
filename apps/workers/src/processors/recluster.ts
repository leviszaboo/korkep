import { and, gt, inArray, lte, sql } from 'drizzle-orm';
import { db, schema } from '../lib/db.js';
import { config } from '../config.js';
import { CLUSTERING } from '@korkep/shared';
import { generateStoryTitleAndSummary, type StoryTitleResult } from '../processors/summarizer.js';
import { mergeEntitiesFuzzy } from '../processors/clusterer.js';
import type { LlmActivity } from '../lib/llm-usage.js';
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

export async function runRecluster(activity: LlmActivity) {
  logger.info(
    { noCache: config.recluster.noCache, storyModel: config.recluster.llmModel },
    'Recluster settings',
  );
  const cutoff = new Date(Date.now() - CLUSTERING.timeWindowHours * 60 * 60 * 1000);

  const articleColumns = {
    id: schema.articles.id,
    title: schema.articles.title,
    summary: schema.articles.summary,
    topics: schema.articles.topics,
    sourceId: schema.articles.sourceId,
    embedding: schema.articles.embedding,
    articleType: schema.articles.articleType,
    entities: schema.articles.entities,
    publishedAt: schema.articles.publishedAt,
    createdAt: schema.articles.createdAt,
    storyId: schema.articles.storyId,
  };

  const recentArticles = await db
    .select(articleColumns)
    .from(schema.articles)
    .where(gt(schema.articles.createdAt, cutoff));

  // Fetch older articles that belong to stories spanning the cutoff boundary
  const activeStoryIds = [...new Set(recentArticles.map((a) => a.storyId).filter((id) => id != null))];
  let olderTails: typeof recentArticles = [];
  if (activeStoryIds.length > 0) {
    olderTails = await db
      .select(articleColumns)
      .from(schema.articles)
      .where(and(inArray(schema.articles.storyId, activeStoryIds), lte(schema.articles.createdAt, cutoff)));
    if (olderTails.length > 0) {
      logger.info({ count: olderTails.length, stories: activeStoryIds.length }, 'Fetched older story tails across cutoff boundary');
    }
  }

  const articles = [...recentArticles, ...olderTails];

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

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.batchClusterer.url.includes('run.app')) {
    const tokenUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${config.batchClusterer.url}`;
    const tokenRes = await fetch(tokenUrl, { headers: { 'Metadata-Flavor': 'Google' } });
    if (tokenRes.ok) {
      headers['Authorization'] = `Bearer ${await tokenRes.text()}`;
    }
  }

  const res = await fetch(`${config.batchClusterer.url}/recluster`, {
    method: 'POST',
    headers,
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

  // Prepare all cluster metadata
  interface ClusterData {
    articleIds: number[];
    sourceIds: Set<number>;
    biasGroups: Set<string>;
    firstSeenAt: Date;
    relevanceScore: number;
    storyTopics: string[];
    storyEntities: string[];
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
    const storyEntities = mergeEntitiesFuzzy(clusterArticles.flatMap((a) => a.entities ?? []));
    const clusterFingerprint = articleIds.slice().sort((a, b) => a - b).join(',');

    clusters.push({ articleIds, sourceIds, biasGroups, firstSeenAt, relevanceScore, storyTopics, storyEntities, clusterFingerprint, clusterArticles });
  }

  // Generate titles and summaries in parallel via OpenRouter
  // Clusters may be split by the LLM if incoherent, producing additional sub-clusters
  const LLM_CONCURRENCY = config.recluster.llmConcurrency;

  interface FinalStory {
    title: string;
    summary: string | null;
    articleIds: number[];
    sourceIds: Set<number>;
    biasGroups: Set<string>;
    firstSeenAt: Date;
    relevanceScore: number;
    storyTopics: string[];
    storyEntities: string[];
  }

  const finalStories: FinalStory[] = [];

  async function processCluster(cluster: ClusterData): Promise<FinalStory[]> {
    if (!config.recluster.noCache) {
      const cached = storyFingerprints.get(cluster.clusterFingerprint);
      if (cached) {
        logger.info({ storyTitle: cached.title, articleCount: cluster.articleIds.length }, 'Reused cached story title/summary');
        return [{ ...cluster, title: cached.title, summary: cached.summary }];
      }
    }

    if (cluster.articleIds.length < 2) {
      return [{ ...cluster, title: cluster.clusterArticles[0].title, summary: cluster.clusterArticles[0].summary }];
    }

    const articles = cluster.clusterArticles.map((a) => ({ id: a.id, title: a.title, summary: a.summary }));
    const result = await generateStoryTitleAndSummary(articles, activity);

    if (result && !result.coherent) {
      const groupDetails = result.groups.map((ids) =>
        ids.map((id) => cluster.clusterArticles.find((a) => a.id === id)?.title ?? `#${id}`),
      );
      logger.info(
        { groups: groupDetails, articleCount: cluster.articleIds.length },
        'LLM detected incoherent cluster, splitting',
      );

      const subStories: FinalStory[] = [];
      for (const groupIds of result.groups) {
        const groupArticles = groupIds
          .map((id) => cluster.clusterArticles.find((a) => a.id === id))
          .filter((a): a is NonNullable<typeof a> => a != null);

        if (groupArticles.length === 0) continue;

        const subSourceIds = new Set(groupArticles.map((a) => a.sourceId));
        const subBiasGroups = new Set(
          [...subSourceIds].map((sid) => normalizeBiasGroup(sourceBiasMap.get(sid) ?? 'center')),
        );
        const subFirstSeenAt = groupArticles.reduce((earliest, a) => {
          const ts = a.publishedAt ?? a.createdAt;
          return ts < earliest ? ts : earliest;
        }, groupArticles[0].publishedAt ?? groupArticles[0].createdAt);

        let subTitle = groupArticles[0].title;
        let subSummary: string | null = groupArticles[0].summary;
        if (groupArticles.length >= 2) {
          const subResult = await generateStoryTitleAndSummary(
            groupArticles.map((a) => ({ id: a.id, title: a.title, summary: a.summary })),
            activity,
          );
          if (subResult?.coherent) {
            subTitle = subResult.title;
            subSummary = subResult.summary;
          }
        }

        subStories.push({
          title: subTitle,
          summary: subSummary,
          articleIds: groupArticles.map((a) => a.id),
          sourceIds: subSourceIds,
          biasGroups: subBiasGroups,
          firstSeenAt: subFirstSeenAt,
          relevanceScore: computeRelevanceScore(subSourceIds.size, groupArticles.length, subBiasGroups.size),
          storyTopics: aggregateTopics(groupArticles.map((a) => a.topics)),
          storyEntities: mergeEntitiesFuzzy(groupArticles.flatMap((a) => a.entities ?? [])),
        });
      }

      return subStories;
    }

    if (result?.coherent) {
      logger.info({ storyTitle: result.title, articleCount: cluster.articleIds.length }, 'Generated story title');
      return [{ ...cluster, title: result.title, summary: result.summary }];
    }

    return [{ ...cluster, title: cluster.clusterArticles[0].title, summary: cluster.clusterArticles[0].summary }];
  }

  let running = 0;
  let next = 0;

  await new Promise<void>((resolve) => {
    let settled = false;

    function launch() {
      while (running < LLM_CONCURRENCY && next < clusters.length) {
        const idx = next++;
        running++;

        processCluster(clusters[idx])
          .then((stories) => {
            finalStories.push(...stories);
          })
          .catch((err) => {
            logger.error({ err, articleCount: clusters[idx].articleIds.length }, 'Story title/summary generation failed');
            finalStories.push({
              title: clusters[idx].clusterArticles[0].title,
              summary: null,
              articleIds: clusters[idx].articleIds,
              sourceIds: clusters[idx].sourceIds,
              biasGroups: clusters[idx].biasGroups,
              firstSeenAt: clusters[idx].firstSeenAt,
              relevanceScore: clusters[idx].relevanceScore,
              storyTopics: clusters[idx].storyTopics,
              storyEntities: clusters[idx].storyEntities,
            });
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

  logger.info({ total: finalStories.length, originalClusters: clusters.length }, 'Story title/summary generation complete');

  // Post-merge: merge similar clusters that HDBSCAN kept separate
  const mergeThreshold = config.recluster.postMergeThreshold;
  const mergeMaxSize = config.recluster.postMergeMaxSize;

  if (mergeThreshold < 1.0 && finalStories.length > 1) {
    const centroids: number[][] = finalStories.map((story) => {
      const vecs = story.articleIds
        .map((id) => articleMap.get(id)?.embedding)
        .filter((e): e is number[] => e != null);
      if (vecs.length === 0) return [];
      const dim = vecs[0].length;
      const centroid = new Array(dim).fill(0);
      for (const v of vecs) {
        for (let i = 0; i < dim; i++) centroid[i] += v[i];
      }
      for (let i = 0; i < dim; i++) centroid[i] /= vecs.length;
      return centroid;
    });

    const withCentroid = centroids.filter((c) => c.length > 0).length;
    const multiArticle = finalStories.filter((s) => s.articleIds.length >= 2).length;
    logger.info(
      { totalStories: finalStories.length, withCentroid, multiArticle, threshold: mergeThreshold },
      'Post-merge: starting centroid comparison',
    );

    // Build merge graph via connected components
    const parent = Array.from({ length: finalStories.length }, (_, i) => i);
    function find(x: number): number {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a: number, b: number) { parent[find(a)] = find(b); }

    function cosineSim(a: number[], b: number[]): number {
      if (a.length === 0 || b.length === 0) return 0;
      let dot = 0, magA = 0, magB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
      }
      const denom = Math.sqrt(magA) * Math.sqrt(magB);
      return denom > 0 ? dot / denom : 0;
    }

    // Debug: find top similarities
    const topPairs: { i: number; j: number; sim: number }[] = [];
    for (let i = 0; i < finalStories.length; i++) {
      for (let j = i + 1; j < finalStories.length; j++) {
        if (centroids[i].length === 0 || centroids[j].length === 0) continue;
        const sim = cosineSim(centroids[i], centroids[j]);
        if (sim > mergeThreshold - 0.10) {
          topPairs.push({ i, j, sim });
        }
      }
    }
    topPairs.sort((a, b) => b.sim - a.sim);
    if (topPairs.length > 0) {
      const top10 = topPairs.slice(0, 10).map((p) => ({
        sim: p.sim.toFixed(4),
        a: finalStories[p.i].title.slice(0, 50),
        b: finalStories[p.j].title.slice(0, 50),
        sizeA: finalStories[p.i].articleIds.length,
        sizeB: finalStories[p.j].articleIds.length,
      }));
      logger.info({ top10, threshold: mergeThreshold }, 'Post-merge: top centroid similarities');
    }

    for (let i = 0; i < finalStories.length; i++) {
      for (let j = i + 1; j < finalStories.length; j++) {
        if (find(i) === find(j)) continue;
        const sim = cosineSim(centroids[i], centroids[j]);
        if (sim >= mergeThreshold) {
          // Check merged size wouldn't exceed cap
          const rootI = find(i);
          const rootJ = find(j);
          let sizeI = 0, sizeJ = 0;
          for (let k = 0; k < finalStories.length; k++) {
            if (find(k) === rootI) sizeI += finalStories[k].articleIds.length;
            if (find(k) === rootJ) sizeJ += finalStories[k].articleIds.length;
          }
          if (sizeI + sizeJ <= mergeMaxSize) {
            union(i, j);
          }
        }
      }
    }

    // Collect merged groups
    const mergeGroups = new Map<number, number[]>();
    for (let i = 0; i < finalStories.length; i++) {
      const root = find(i);
      const group = mergeGroups.get(root) ?? [];
      group.push(i);
      mergeGroups.set(root, group);
    }

    const mergedCount = [...mergeGroups.values()].filter((g) => g.length > 1).length;
    if (mergedCount > 0) {
      const mergedStories: FinalStory[] = [];
      for (const [, indices] of mergeGroups) {
        if (indices.length === 1) {
          mergedStories.push(finalStories[indices[0]]);
          continue;
        }
        // Merge all stories in this group
        const base = finalStories[indices[0]];
        const allArticleIds = indices.flatMap((i) => finalStories[i].articleIds);
        const allSourceIds = new Set(indices.flatMap((i) => [...finalStories[i].sourceIds]));
        const allBiasGroups = new Set(indices.flatMap((i) => [...finalStories[i].biasGroups]));
        const earliestFirst = indices.reduce((earliest, i) => {
          const fs = finalStories[i].firstSeenAt;
          return fs < earliest ? fs : earliest;
        }, base.firstSeenAt);
        const allTopics = aggregateTopics(
          allArticleIds.map((id) => articleMap.get(id)?.topics ?? null),
        );

        // Use title from the largest sub-cluster
        const largestIdx = indices.reduce((best, i) =>
          finalStories[i].articleIds.length > finalStories[best].articleIds.length ? i : best, indices[0]);

        mergedStories.push({
          title: finalStories[largestIdx].title,
          summary: finalStories[largestIdx].summary,
          articleIds: allArticleIds,
          sourceIds: allSourceIds,
          biasGroups: allBiasGroups,
          firstSeenAt: earliestFirst,
          relevanceScore: computeRelevanceScore(allSourceIds.size, allArticleIds.length, allBiasGroups.size),
          storyTopics: allTopics,
          storyEntities: mergeEntitiesFuzzy(indices.flatMap((i) => finalStories[i].storyEntities)),
        });
      }

      logger.info(
        { merged: mergedCount, before: finalStories.length, after: mergedStories.length, threshold: mergeThreshold },
        'Post-merge complete',
      );
      finalStories.length = 0;
      finalStories.push(...mergedStories);
    }
  }

  // Swap old clusters for new ones in a single transaction
  await db.transaction(async (tx) => {
    await tx.update(schema.articles).set({ storyId: null });
    await tx.delete(schema.stories);

    for (const story of finalStories) {
      const [newStory] = await tx
        .insert(schema.stories)
        .values({
          title: story.title,
          summary: story.summary,
          topics: story.storyTopics.length > 0 ? story.storyTopics : null,
          entities: story.storyEntities.length > 0 ? story.storyEntities : null,
          articleCount: story.articleIds.length,
          sourceCount: story.sourceIds.size,
          relevanceScore: story.relevanceScore,
          firstSeenAt: story.firstSeenAt,
        })
        .returning({ id: schema.stories.id });

      await tx
        .update(schema.articles)
        .set({ storyId: newStory.id })
        .where(inArray(schema.articles.id, story.articleIds));
    }
  });

  logger.info(
    { stories: finalStories.length, articles: withEmbeddings.length },
    'Recluster complete',
  );
}
