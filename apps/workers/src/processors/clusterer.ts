import { sql, eq } from 'drizzle-orm';
import { db, schema } from '../lib/db.js';
import { config } from '../config.js';
import { CLUSTERING } from '@korkep/shared';

const MAX_CLUSTER_SIZE = CLUSTERING.maxClusterSize;

function significantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = new Set([...a, ...b]).size;
  return union > 0 ? shared / union : 0;
}

function entityOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a.map((e) => e.toLowerCase()));
  const setB = new Set(b.map((e) => e.toLowerCase()));
  let shared = 0;
  for (const e of setA) if (setB.has(e)) shared++;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? shared / union : 0;
}

function updateCentroid(
  current: number[],
  newVec: number[],
  count: number,
): number[] {
  const result = new Array(current.length);
  for (let i = 0; i < current.length; i++) {
    result[i] = (current[i] * count + newVec[i]) / (count + 1);
  }
  return result;
}

function mergeEntities(existing: string[], incoming: string[]): string[] {
  return mergeEntitiesFuzzy([...existing, ...incoming]);
}

/**
 * Fuzzy-dedup: if one entity is a substring of another (case-insensitive),
 * keep the longer form. "orbán" + "orbán viktor" → "orbán viktor".
 * Titles/roles like "miniszterelnök" stay separate (no substring relation).
 */
export function mergeEntitiesFuzzy(all: string[], limit = 15): string[] {
  const normalized = all.map((e) => ({ original: e, lower: e.toLowerCase().trim() }));

  // Count occurrences to prefer more frequent forms
  const counts = new Map<string, number>();
  for (const { lower } of normalized) {
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
  }

  // Deduplicate exact matches first, keeping the most common casing
  const uniqueByLower = new Map<string, string>();
  for (const { original, lower } of normalized) {
    const existing = uniqueByLower.get(lower);
    if (!existing) {
      uniqueByLower.set(lower, original);
    }
  }

  let entities = [...uniqueByLower.values()];

  // Absorb shorter forms into longer ones via substring matching
  const absorbed = new Set<number>();
  for (let i = 0; i < entities.length; i++) {
    if (absorbed.has(i)) continue;
    for (let j = 0; j < entities.length; j++) {
      if (i === j || absorbed.has(j)) continue;
      const li = entities[i].toLowerCase();
      const lj = entities[j].toLowerCase();
      if (li.length < lj.length && lj.includes(li)) {
        absorbed.add(i);
        break;
      }
    }
  }

  entities = entities.filter((_, i) => !absorbed.has(i));
  return entities.slice(0, limit);
}

export async function assignStory(
  articleTitle: string,
  embedding: number[],
  sourceId: number,
  articleEntities?: string[] | null,
  articleSummary?: string | null,
  matchingText = articleTitle,
): Promise<number> {
  const cutoff = new Date(Date.now() - config.embedding.storyAssignLookbackHours * 60 * 60 * 1000);
  const vectorLiteral = `[${embedding.join(',')}]`;

  const candidates = await db.execute<{
    id: number;
    title: string;
    article_count: number;
    source_count: number;
    centroid_embedding: string | null;
    entities: string[] | null;
    created_at: string;
    similarity: number;
  }>(sql`
    SELECT
      id, title, article_count, source_count,
      centroid_embedding::text, entities, created_at,
      1 - (centroid_embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM stories
    WHERE centroid_embedding IS NOT NULL
      AND updated_at > ${cutoff.toISOString()}
      AND 1 - (centroid_embedding <=> ${vectorLiteral}::vector) > ${CLUSTERING.similarityThreshold - 0.05}
    ORDER BY similarity DESC
    LIMIT 10
  `);

  const rows = candidates.rows ?? [];
  const newTokens = significantTokens(matchingText);
  const newEntities = articleEntities ?? [];

  let bestStoryId: number | null = null;
  let bestScore = 0;

  for (const row of rows) {
    if (row.article_count >= MAX_CLUSTER_SIZE) continue;

    const hoursDiff = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
    const decayFactor = Math.exp(-hoursDiff / 24);

    const semanticSim = row.similarity * decayFactor;

    const storyEntities = row.entities ?? [];
    const entOverlap = entityOverlap(newEntities, storyEntities);

    const candidateTokens = significantTokens(row.title);
    const tokOverlap = tokenOverlap(newTokens, candidateTokens);

    const combinedScore =
      semanticSim * CLUSTERING.semanticWeight +
      entOverlap * CLUSTERING.entityOverlapWeight +
      tokOverlap * CLUSTERING.tokenOverlapWeight;

    // Adaptive threshold: larger clusters require stronger matches
    const sizePenalty = (row.article_count / MAX_CLUSTER_SIZE) * 0.05;
    const effectiveThreshold = CLUSTERING.similarityThreshold + sizePenalty;

    if (combinedScore < effectiveThreshold) continue;

    // Coherence check: raw semantic similarity to centroid must stay above floor
    if (row.similarity < CLUSTERING.minCoherenceSimilarity) continue;

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestStoryId = row.id;
    }
  }

  if (bestStoryId != null) {
    return db.transaction(async (tx) => {
      const locked = await tx.execute<{
        id: number;
        title: string;
        article_count: number;
        source_count: number;
        centroid_embedding: string | null;
        entities: string[] | null;
        created_at: string;
      }>(sql`
        SELECT id, title, article_count, source_count, centroid_embedding::text, entities, created_at
        FROM stories
        WHERE id = ${bestStoryId}
        FOR UPDATE
      `);

      const bestRow = locked.rows?.[0];
      if (!bestRow) throw new Error(`Story ${bestStoryId} disappeared during assignment`);
      if (bestRow.article_count >= MAX_CLUSTER_SIZE) {
        return createStory(tx, articleTitle, embedding, newEntities, vectorLiteral, articleSummary);
      }

      const [existingSources, newSourceBias] = await Promise.all([
        tx.execute<{ source_id: number; bias_rating: string }>(sql`
          SELECT DISTINCT a.source_id, s.bias_rating
          FROM articles a
          JOIN sources s ON s.id = a.source_id
          WHERE a.story_id = ${bestStoryId}
        `),
        tx.execute<{ bias_rating: string }>(sql`
          SELECT bias_rating FROM sources WHERE id = ${sourceId} LIMIT 1
        `),
      ]);

      const sourceRows = existingSources.rows ?? [];
      const sourceIds = new Set(sourceRows.map((r) => r.source_id));
      const newSourceCount = sourceIds.has(sourceId) ? sourceIds.size : sourceIds.size + 1;
      const newArticleCount = bestRow.article_count + 1;

      const biasGroups = new Set(sourceRows.map((r) => normalizeBiasGroup(r.bias_rating)));
      if (!sourceIds.has(sourceId) && newSourceBias.rows?.[0]) {
        biasGroups.add(normalizeBiasGroup(newSourceBias.rows[0].bias_rating));
      }

      const relevanceScore = computeRelevanceScore(newSourceCount, newArticleCount, biasGroups.size);
      const currentCentroid = bestRow.centroid_embedding
        ? parsePgVector(bestRow.centroid_embedding)
        : embedding;
      const newCentroid = updateCentroid(currentCentroid, embedding, bestRow.article_count);
      const centroidLiteral = `[${newCentroid.join(',')}]`;
      const updatedEntities = mergeEntities(bestRow.entities ?? [], newEntities);

      await tx
        .update(schema.stories)
        .set({
          articleCount: sql`article_count + 1`,
          sourceCount: newSourceCount,
          relevanceScore,
          centroidEmbedding: sql`${centroidLiteral}::vector`,
          entities: updatedEntities.length > 0 ? updatedEntities : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.stories.id, bestStoryId));

      return bestStoryId;
    });
  }

  // No match — create new story with this article's embedding as initial centroid
  return createStory(db, articleTitle, embedding, newEntities, vectorLiteral, articleSummary);
}

async function createStory(
  executor: { insert: typeof db.insert },
  articleTitle: string,
  _embedding: number[],
  newEntities: string[],
  vectorLiteral: string,
  articleSummary?: string | null,
): Promise<number> {
  const [newStory] = await executor
    .insert(schema.stories)
    .values({
      title: articleTitle,
      summary: articleSummary ?? null,
      articleCount: 1,
      sourceCount: 1,
      relevanceScore: computeRelevanceScore(1, 1, 1),
      centroidEmbedding: sql`${vectorLiteral}::vector`,
      entities: newEntities.length > 0 ? newEntities : null,
    })
    .returning({ id: schema.stories.id });

  return newStory.id;
}

function parsePgVector(str: string): number[] {
  return str
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(Number);
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
