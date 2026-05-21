import { and, gt, inArray, lte, sql } from 'drizzle-orm';
import { db, schema } from '../lib/db.js';
import { config } from '../config.js';
import { generateStoryTitleAndSummary, type StoryTitleResult } from '../processors/summarizer.js';
import { mergeEntitiesFuzzy } from '../processors/clusterer.js';
import { averageVectors, buildRecursiveMergeGroups, cosineSimilarity } from './utils/recluster-merge.js';
import { planStoryReconciliation } from './utils/recluster-reconcile.js';
import {
  getCachedReclusterDecision,
  getPriorIncoherentOverlaps,
  hasPriorIncoherentOverlap,
  storeReclusterDecision,
} from './utils/recluster-decision-cache.js';
import {
  clusterMetadataLooksSuspicious,
  findEmbeddingOutliers,
  metadataSuspicionScore,
  type QualityArticle,
} from './utils/cluster-quality.js';
import { classifyEventRole } from './story-identity.js';
import { buildActivity, type LlmActivity, type TriggerMode } from '../lib/llm-usage.js';
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

function arraysEqual(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function shouldValidateMergedCluster(parts: Array<{ articleIds: number[]; roles: string[] }>): boolean {
  if (parts.length <= 1) return false;
  const allRoles = new Set(parts.flatMap((part) => part.roles));
  if (allRoles.has('analysis') || allRoles.has('background') || allRoles.has('reaction')) return true;
  return parts.some((part) => part.articleIds.length === 1);
}

export function postMergeValidationActivity(activity: LlmActivity): LlmActivity {
  const trigger = activity.startsWith('manual_') ? 'manual' : 'scheduled';
  return buildActivity(trigger as TriggerMode, 'recluster', 'storyvalidate');
}

export async function runRecluster(activity: LlmActivity) {
  const validationActivity = postMergeValidationActivity(activity);

  logger.info(
    {
      seedHours: config.recluster.seedHours,
      noCache: config.recluster.noCache,
      storyModel: config.recluster.llmModel,
    },
    'Recluster settings',
  );
  const seedCutoff = new Date(Date.now() - config.recluster.seedHours * 60 * 60 * 1000);

  const articleColumns = {
    id: schema.articles.id,
    title: schema.articles.title,
    summary: schema.articles.summary,
    mainEvent: schema.articles.mainEvent,
    storyIdentity: schema.articles.storyIdentity,
    topics: schema.articles.topics,
    sourceId: schema.articles.sourceId,
    embedding: schema.articles.embedding,
    articleType: schema.articles.articleType,
    location: schema.articles.location,
    entities: schema.articles.entities,
    publishedAt: schema.articles.publishedAt,
    createdAt: schema.articles.createdAt,
    storyId: schema.articles.storyId,
  };

  const recentArticles = await db
    .select(articleColumns)
    .from(schema.articles)
    .where(gt(schema.articles.createdAt, seedCutoff));

  // Fetch older articles that belong to stories spanning the cutoff boundary
  const activeStoryIds = [...new Set(recentArticles.map((a) => a.storyId).filter((id) => id != null))];
  let olderTails: typeof recentArticles = [];
  if (activeStoryIds.length > 0) {
    olderTails = await db
      .select(articleColumns)
      .from(schema.articles)
      .where(and(inArray(schema.articles.storyId, activeStoryIds), lte(schema.articles.createdAt, seedCutoff)));
    if (olderTails.length > 0) {
      logger.info({ count: olderTails.length, stories: activeStoryIds.length }, 'Fetched older story tails across cutoff boundary');
    }
  }

  const articles = [...recentArticles, ...olderTails];

  // Exclude aggregation articles from clustering — they span multiple stories
  const withEmbeddings = articles.filter((a) => a.embedding != null && a.articleType !== 'aggregation');
  const scopedStoryIds = [
    ...new Set(withEmbeddings.map((article) => article.storyId).filter((id): id is number => id != null)),
  ];

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
  const existingStories = scopedStoryIds.length > 0
    ? await db
        .select({
          id: schema.stories.id,
          title: schema.stories.title,
          summary: schema.stories.summary,
          topics: schema.stories.topics,
          entities: schema.stories.entities,
          articleCount: schema.stories.articleCount,
          sourceCount: schema.stories.sourceCount,
          relevanceScore: schema.stories.relevanceScore,
          firstSeenAt: schema.stories.firstSeenAt,
        })
        .from(schema.stories)
        .where(inArray(schema.stories.id, scopedStoryIds))
    : [];
  const existingStoryById = new Map(existingStories.map((story) => [story.id, story]));

  const existingArticlesByStory = scopedStoryIds.length > 0
    ? await db
        .select({ storyId: schema.articles.storyId, articleId: schema.articles.id })
        .from(schema.articles)
        .where(inArray(schema.articles.storyId, scopedStoryIds))
    : [];

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
    centroidEmbedding: number[];
    clusterFingerprint: string;
    clusterArticles: typeof withEmbeddings;
  }

  function buildClusterData(articleIds: number[]): ClusterData {
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
    const centroidEmbedding = averageVectors(clusterArticles.map((a) => a.embedding!));
    const clusterFingerprint = articleIds.slice().sort((a, b) => a - b).join(',');

    return { articleIds, sourceIds, biasGroups, firstSeenAt, relevanceScore, storyTopics, storyEntities, centroidEmbedding, clusterFingerprint, clusterArticles };
  }

  function toQualityArticle(article: typeof withEmbeddings[number]): QualityArticle {
    return {
      id: article.id,
      title: article.title,
      summary: article.summary,
      mainEvent: article.mainEvent,
      storyIdentity: article.storyIdentity,
      articleType: article.articleType,
      location: article.location,
      entities: article.entities,
      topics: article.topics,
      embedding: article.embedding,
    };
  }

  function coherentCacheCanBeReused(cluster: ClusterData): { allowed: boolean; reason: string } {
    const metadata = clusterMetadataLooksSuspicious(cluster.clusterArticles.map(toQualityArticle));
    if (metadata.suspicious) return { allowed: false, reason: metadata.reason };

    const outliers = findSuspiciousOutliers(cluster);
    if (outliers.length > 0) {
      return { allowed: false, reason: `embedding outliers: ${outliers.map((outlier) => `#${outlier.article.id} ${outlier.reason}`).join('; ')}` };
    }

    return { allowed: true, reason: 'cache reusable' };
  }

  function findSuspiciousOutliers(cluster: ClusterData) {
    const qualityArticles = cluster.clusterArticles.map(toQualityArticle);
    const outliers = findEmbeddingOutliers(qualityArticles, cluster.centroidEmbedding);
    if (outliers.length === 0) return [];

    return outliers.filter((outlier) => {
      const rest = cluster.clusterArticles.filter((article) => article.id !== outlier.article.id);
      const restMetadata = {
        title: rest.map((article) => article.storyIdentity ?? article.mainEvent ?? article.title).join(' '),
        entities: mergeEntitiesFuzzy(rest.flatMap((article) => article.entities ?? [])),
        topics: aggregateTopics(rest.map((article) => article.topics)),
      };
      return metadataSuspicionScore(outlier.article, restMetadata).suspicious;
    });
  }

  function splitSuspiciousOutliers(cluster: ClusterData): { stories: FinalStory[]; groups: number[][] } | null {
    const outliers = findSuspiciousOutliers(cluster);
    if (outliers.length === 0) return null;

    const outlierIds = new Set(outliers.map((outlier) => outlier.article.id).filter((id): id is number => id != null));
    const mainIds = cluster.articleIds.filter((id) => !outlierIds.has(id));
    if (mainIds.length === 0) return null;

    logger.info(
      {
        articleIds: cluster.articleIds,
        outliers: outliers.map((outlier) => ({ id: outlier.article.id, reason: outlier.reason })),
      },
      'Embedding/metadata guard split coherent cluster',
    );

    const groups = [mainIds, ...[...outlierIds].map((id) => [id])];
    const stories = groups.map((groupIds) => {
      const groupCluster = buildClusterData(groupIds);
      return {
        ...groupCluster,
        clusterKey: groupCluster.clusterFingerprint,
        title: groupCluster.clusterArticles[0].title,
        summary: groupCluster.clusterArticles[0].summary,
      };
    });

    return { stories, groups };
  }

  function findReusableStory(articleIds: number[]): { title: string; summary: string | null } | null {
    const articleIdSet = new Set(articleIds);
    let best: { storyId: number; title: string; summary: string | null; overlap: number; ratio: number } | null = null;

    for (const [storyId, storyArticleIds] of storyArticleMap) {
      const story = existingStoryById.get(storyId);
      if (!story) continue;

      let overlap = 0;
      for (const articleId of storyArticleIds) {
        if (articleIdSet.has(articleId)) overlap += 1;
      }
      if (overlap === 0) continue;

      const ratio = overlap / storyArticleIds.length;
      if (
        best == null
        || overlap > best.overlap
        || (overlap === best.overlap && ratio > best.ratio)
        || (overlap === best.overlap && ratio === best.ratio && storyId < best.storyId)
      ) {
        best = { storyId, title: story.title, summary: story.summary, overlap, ratio };
      }
    }

    return best ? { title: best.title, summary: best.summary } : null;
  }

  const clusters: ClusterData[] = [];
  for (const [, articleIds] of clusterGroups) {
    clusters.push(buildClusterData(articleIds));
  }

  // Generate titles and summaries in parallel via OpenRouter
  // Clusters may be split by the LLM if incoherent, producing additional sub-clusters
  const LLM_CONCURRENCY = config.recluster.llmConcurrency;

  interface FinalStory {
    clusterKey: string;
    title: string;
    summary: string | null;
    articleIds: number[];
    sourceIds: Set<number>;
    biasGroups: Set<string>;
    firstSeenAt: Date;
    relevanceScore: number;
    storyTopics: string[];
    storyEntities: string[];
    centroidEmbedding: number[];
  }

  const finalStories: FinalStory[] = [];

  async function processCluster(cluster: ClusterData): Promise<FinalStory[]> {
    if (cluster.articleIds.length < 2) {
      return [{
        ...cluster,
        clusterKey: cluster.clusterFingerprint,
        title: cluster.clusterArticles[0].title,
        summary: cluster.clusterArticles[0].summary,
      }];
    }

    const priorSplit = cluster.articleIds.length >= 3
      ? await hasPriorIncoherentOverlap(cluster.articleIds, getPriorIncoherentOverlaps)
      : { blocked: false as const };
    if (priorSplit.blocked) {
      const clusterSet = new Set(cluster.articleIds);
      const splitArticleIds = new Set(priorSplit.splitGroups.flatMap((group) => group));
      const groups = priorSplit.splitGroups
        .map((groupIds) => groupIds.filter((id) => clusterSet.has(id)))
        .filter((groupIds) => groupIds.length > 0);
      const leftovers = cluster.articleIds.filter((id) => !splitArticleIds.has(id));
      groups.push(...leftovers.map((id) => [id]));

      logger.info({ reason: priorSplit.reason, articleIds: cluster.articleIds }, 'Prior incoherent decision blocks cluster merge');
      return (await Promise.all(groups.map((groupIds) =>
        processCluster(buildClusterData(groupIds)),
      ))).flat();
    }

    if (!config.recluster.noCache) {
      const cached = storyFingerprints.get(cluster.clusterFingerprint);
      if (cached) {
        const cacheReuse = coherentCacheCanBeReused(cluster);
        if (!cacheReuse.allowed) {
          logger.info({ reason: cacheReuse.reason, articleIds: cluster.articleIds }, 'Bypassed cached story title/summary');
        } else {
          logger.info({ storyTitle: cached.title, articleCount: cluster.articleIds.length }, 'Reused cached story title/summary');
          return [{ ...cluster, clusterKey: cluster.clusterFingerprint, title: cached.title, summary: cached.summary }];
        }
      }
    }

    const articles = cluster.clusterArticles.map((a) => ({ id: a.id, title: a.title, summary: a.summary }));
    let result: StoryTitleResult | null = null;
    let resultFromCache = false;

    if (!config.recluster.noCache) {
      result = await getCachedReclusterDecision(cluster.clusterFingerprint);
      if (result) {
        resultFromCache = true;
        if (result.coherent) {
          const cacheReuse = coherentCacheCanBeReused(cluster);
          if (!cacheReuse.allowed) {
            logger.info({ reason: cacheReuse.reason, articleIds: cluster.articleIds }, 'Bypassed cached coherent recluster decision');
            result = null;
            resultFromCache = false;
          }
        }
        if (result) {
          logger.info({ articleCount: cluster.articleIds.length, coherent: result.coherent }, 'Reused cached recluster decision');
        }
      }
    }

    if (!result) {
      const reusableStory = findReusableStory(cluster.articleIds);
      result = await generateStoryTitleAndSummary(articles, activity, undefined, reusableStory);
      if (result && result.coherent) {
        const guardedSplit = splitSuspiciousOutliers(cluster);
        if (guardedSplit) {
          if (!config.recluster.noCache) {
            await storeReclusterDecision({
              articleIds: cluster.articleIds,
              model: config.recluster.llmModel,
              result: { coherent: false, groups: guardedSplit.groups },
              diagnostics: { guard: 'embedding/metadata outlier split' },
            });
          }
          return guardedSplit.stories;
        }
      }

      if (result && !config.recluster.noCache) {
        await storeReclusterDecision({
          articleIds: cluster.articleIds,
          model: config.recluster.llmModel,
          result,
          diagnostics: result.coherent
            ? { guard: coherentCacheCanBeReused(cluster) }
            : null,
        });
      }
    }

    if (result && !result.coherent) {
      const groupDetails = result.groups.map((ids) =>
        ids.map((id) => cluster.clusterArticles.find((a) => a.id === id)?.title ?? `#${id}`),
      );
      logger.info(
        { groups: groupDetails, articleCount: cluster.articleIds.length },
        resultFromCache ? 'Cached recluster decision split cluster' : 'LLM detected incoherent cluster, splitting',
      );

      const subStories: FinalStory[] = [];
      for (const groupIds of result.groups) {
        const groupArticles = groupIds
          .map((id) => cluster.clusterArticles.find((a) => a.id === id))
          .filter((a): a is NonNullable<typeof a> => a != null);

        if (groupArticles.length === 0) continue;

        subStories.push(...await processCluster(buildClusterData(groupArticles.map((a) => a.id))));
      }

      return subStories;
    }

    if (result?.coherent) {
      const guardedSplit = splitSuspiciousOutliers(cluster);
      if (guardedSplit) return guardedSplit.stories;

      logger.info({ storyTitle: result.title, articleCount: cluster.articleIds.length }, 'Generated story title');
      return [{ ...cluster, clusterKey: cluster.clusterFingerprint, title: result.title, summary: result.summary }];
    }

    return [{
      ...cluster,
      clusterKey: cluster.clusterFingerprint,
      title: cluster.clusterArticles[0].title,
      summary: cluster.clusterArticles[0].summary,
    }];
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
              clusterKey: clusters[idx].clusterFingerprint,
              title: clusters[idx].clusterArticles[0].title,
              summary: null,
              articleIds: clusters[idx].articleIds,
              sourceIds: clusters[idx].sourceIds,
              biasGroups: clusters[idx].biasGroups,
              firstSeenAt: clusters[idx].firstSeenAt,
              relevanceScore: clusters[idx].relevanceScore,
              storyTopics: clusters[idx].storyTopics,
              storyEntities: clusters[idx].storyEntities,
              centroidEmbedding: clusters[idx].centroidEmbedding,
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
    const withCentroid = finalStories.filter((s) => s.centroidEmbedding.length > 0).length;
    const multiArticle = finalStories.filter((s) => s.articleIds.length >= 2).length;
    logger.info(
      { totalStories: finalStories.length, withCentroid, multiArticle, threshold: mergeThreshold },
      'Post-merge: starting centroid comparison',
    );

    // Debug: find top similarities
    const topPairs: { i: number; j: number; sim: number }[] = [];
    for (let i = 0; i < finalStories.length; i++) {
      for (let j = i + 1; j < finalStories.length; j++) {
        if (finalStories[i].centroidEmbedding.length === 0 || finalStories[j].centroidEmbedding.length === 0) continue;
        const sim = cosineSimilarity(finalStories[i].centroidEmbedding, finalStories[j].centroidEmbedding);
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

    const mergeGroups = buildRecursiveMergeGroups(
      finalStories.map((story) => ({
        articleIds: story.articleIds,
        centroid: story.centroidEmbedding,
      })),
      mergeThreshold,
      mergeMaxSize,
    );

    const mergedCount = mergeGroups.filter((g) => g.length > 1).length;
    if (mergedCount > 0) {
      const mergedStories: FinalStory[] = [];
      for (const indices of mergeGroups) {
        if (indices.length === 1) {
          mergedStories.push(finalStories[indices[0]]);
          continue;
        }
        // Merge all stories in this group
        const base = finalStories[indices[0]];
        const allArticleIds = indices.flatMap((i) => finalStories[i].articleIds);
        const priorSplit = await hasPriorIncoherentOverlap(allArticleIds, getPriorIncoherentOverlaps);
        if (priorSplit.blocked) {
          logger.info(
            { reason: priorSplit.reason, articleIds: allArticleIds },
            'Prior incoherent decision blocks post-merge',
          );
          for (const index of indices) {
            mergedStories.push(finalStories[index]);
          }
          continue;
        }

        const allSourceIds = new Set(indices.flatMap((i) => [...finalStories[i].sourceIds]));
        const allBiasGroups = new Set(indices.flatMap((i) => [...finalStories[i].biasGroups]));
        const earliestFirst = indices.reduce((earliest, i) => {
          const fs = finalStories[i].firstSeenAt;
          return fs < earliest ? fs : earliest;
        }, base.firstSeenAt);
        const allTopics = aggregateTopics(
          allArticleIds.map((id) => articleMap.get(id)?.topics ?? null),
        );
        const centroidEmbedding = averageVectors(
          allArticleIds
            .map((id) => articleMap.get(id)?.embedding)
            .filter((embedding): embedding is number[] => embedding != null),
        );
        const parts = indices.map((i) => ({
          articleIds: finalStories[i].articleIds,
          roles: finalStories[i].articleIds
            .map((id) => articleMap.get(id))
            .filter((article): article is NonNullable<typeof article> => article != null)
            .map((article) => classifyEventRole(article)),
        }));

        if (shouldValidateMergedCluster(parts)) {
          const mergedArticlesForLlm = allArticleIds
            .map((id) => articleMap.get(id))
            .filter((article): article is NonNullable<typeof article> => article != null)
            .map((article) => ({ id: article.id, title: article.title, summary: article.summary }));

          logger.info(
            { articleCount: mergedArticlesForLlm.length, activity: validationActivity },
            'Validating post-merged cluster with LLM',
          );
          const validation = await generateStoryTitleAndSummary(mergedArticlesForLlm, validationActivity, undefined, null);
          if (validation && !validation.coherent) {
            for (const groupIds of validation.groups) {
              const filteredGroupIds = groupIds.filter((id) => articleMap.has(id));
              if (filteredGroupIds.length === 0) continue;
              const groupCluster = buildClusterData(filteredGroupIds);
              mergedStories.push({
                ...groupCluster,
                clusterKey: groupCluster.clusterFingerprint,
                title: groupCluster.clusterArticles[0].title,
                summary: groupCluster.clusterArticles[0].summary,
              });
            }
            continue;
          }

          if (validation?.coherent) {
            mergedStories.push({
              clusterKey: allArticleIds.slice().sort((a, b) => a - b).join(','),
              title: validation.title,
              summary: validation.summary,
              articleIds: allArticleIds,
              sourceIds: allSourceIds,
              biasGroups: allBiasGroups,
              firstSeenAt: earliestFirst,
              relevanceScore: computeRelevanceScore(allSourceIds.size, allArticleIds.length, allBiasGroups.size),
              storyTopics: allTopics,
              storyEntities: mergeEntitiesFuzzy(indices.flatMap((i) => finalStories[i].storyEntities)),
              centroidEmbedding,
            });
            continue;
          }
        }

        // Use title from the largest sub-cluster
        const largestIdx = indices.reduce((best, i) =>
          finalStories[i].articleIds.length > finalStories[best].articleIds.length ? i : best, indices[0]);

        mergedStories.push({
          clusterKey: allArticleIds.slice().sort((a, b) => a - b).join(','),
          title: finalStories[largestIdx].title,
          summary: finalStories[largestIdx].summary,
          articleIds: allArticleIds,
          sourceIds: allSourceIds,
          biasGroups: allBiasGroups,
          firstSeenAt: earliestFirst,
          relevanceScore: computeRelevanceScore(allSourceIds.size, allArticleIds.length, allBiasGroups.size),
          storyTopics: allTopics,
          storyEntities: mergeEntitiesFuzzy(indices.flatMap((i) => finalStories[i].storyEntities)),
          centroidEmbedding,
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

  const currentAssignments = new Map<number, number | null>();
  for (const row of existingArticlesByStory) {
    currentAssignments.set(row.articleId, row.storyId);
  }
  for (const article of withEmbeddings) {
    if (!currentAssignments.has(article.id)) {
      currentAssignments.set(article.id, article.storyId);
    }
  }

  const existingStoryArticles = [...storyArticleMap.entries()].map(([storyId, articleIds]) => ({
    storyId,
    articleIds,
  }));

  const reconciliation = planStoryReconciliation({
    existingStories: existingStoryArticles,
    finalClusters: finalStories.map((story) => ({
      clusterKey: story.clusterKey,
      articleIds: story.articleIds,
    })),
    currentAssignments,
  });

  const matchByClusterKey = new Map(reconciliation.storyMatches.map((match) => [match.clusterKey, match]));
  let insertedStories = 0;
  let updatedStories = 0;
  let skippedStories = 0;
  let reassignedArticles = 0;
  let clearedArticles = 0;
  let checkedStoryDeletes = 0;

  // Persist only the diff so continuing stories keep stable ids.
  await db.transaction(async (tx) => {
    for (const story of finalStories) {
      const match = matchByClusterKey.get(story.clusterKey);
      let storyId = match?.storyId ?? null;
      const existingStory = storyId == null ? null : existingStoryById.get(storyId);
      const changedArticleIds = match?.changedArticleIds ?? [];
      const storyFieldsUnchanged = existingStory != null
        && existingStory.title === story.title
        && existingStory.summary === story.summary
        && arraysEqual(existingStory.topics, story.storyTopics)
        && arraysEqual(existingStory.entities, story.storyEntities)
        && existingStory.articleCount === story.articleIds.length
        && existingStory.sourceCount === story.sourceIds.size
        && existingStory.relevanceScore === story.relevanceScore
        && new Date(existingStory.firstSeenAt).getTime() === story.firstSeenAt.getTime();

      if (storyId == null) {
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
            centroidEmbedding: story.centroidEmbedding.length > 0 ? story.centroidEmbedding : null,
            firstSeenAt: story.firstSeenAt,
          })
          .returning({ id: schema.stories.id });
        storyId = newStory.id;
        insertedStories += 1;
      } else if (!storyFieldsUnchanged || changedArticleIds.length > 0) {
        await tx
          .update(schema.stories)
          .set({
            title: story.title,
            summary: story.summary,
            topics: story.storyTopics.length > 0 ? story.storyTopics : null,
            entities: story.storyEntities.length > 0 ? story.storyEntities : null,
            articleCount: story.articleIds.length,
            sourceCount: story.sourceIds.size,
            relevanceScore: story.relevanceScore,
            centroidEmbedding: story.centroidEmbedding.length > 0 ? story.centroidEmbedding : null,
            firstSeenAt: story.firstSeenAt,
            updatedAt: new Date(),
          })
          .where(sql`${schema.stories.id} = ${storyId}`);
        updatedStories += 1;
      } else {
        skippedStories += 1;
      }

      if (changedArticleIds.length > 0) {
        await tx
          .update(schema.articles)
          .set({ storyId })
          .where(inArray(schema.articles.id, changedArticleIds));
        reassignedArticles += changedArticleIds.length;
      }
    }

    const assignedArticleIds = new Set(finalStories.flatMap((story) => story.articleIds));
    const scopedArticleIdsToClear = withEmbeddings
      .map((article) => article.id)
      .filter((articleId) => !assignedArticleIds.has(articleId) && currentAssignments.get(articleId) != null);

    if (scopedArticleIdsToClear.length > 0) {
      await tx
        .update(schema.articles)
        .set({ storyId: null })
        .where(inArray(schema.articles.id, scopedArticleIdsToClear));
      clearedArticles += scopedArticleIdsToClear.length;
    }

    if (reconciliation.storyIdsToCheckForDeletion.length > 0) {
      checkedStoryDeletes += reconciliation.storyIdsToCheckForDeletion.length;
      await tx
        .delete(schema.stories)
        .where(and(
          inArray(schema.stories.id, reconciliation.storyIdsToCheckForDeletion),
          sql`NOT EXISTS (
            SELECT 1 FROM ${schema.articles}
            WHERE ${schema.articles.storyId} = ${schema.stories.id}
          )`,
        ));
    }
  });

  logger.info(
    {
      stories: finalStories.length,
      articles: withEmbeddings.length,
      insertedStories,
      updatedStories,
      skippedStories,
      reassignedArticles,
      clearedArticles,
      checkedStoryDeletes,
    },
    'Recluster complete',
  );
}
