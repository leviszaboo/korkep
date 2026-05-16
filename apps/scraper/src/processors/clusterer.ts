import { sql, eq } from 'drizzle-orm';
import { db, schema } from '../lib/db.js';
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

export async function assignStory(
  articleTitle: string,
  embedding: number[],
  sourceId: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - CLUSTERING.timeWindowHours * 60 * 60 * 1000);
  const vectorLiteral = `[${embedding.join(',')}]`;

  const similar = await db.execute<{
    story_id: number | null;
    title: string;
    created_at: string;
    similarity: number;
  }>(sql`
    SELECT story_id, title, created_at, 1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM articles
    WHERE embedding IS NOT NULL
      AND story_id IS NOT NULL
      AND created_at > ${cutoff.toISOString()}
      AND 1 - (embedding <=> ${vectorLiteral}::vector) > ${CLUSTERING.similarityThreshold}
    ORDER BY similarity DESC
    LIMIT 20
  `);

  const rows = similar.rows ?? [];

  if (rows.length > 0) {
    const newTokens = significantTokens(articleTitle);
    const storyBestSim = new Map<number, number>();

    for (const row of rows) {
      if (row.story_id == null) continue;

      const candidateTokens = significantTokens(row.title);
      const overlap = tokenOverlap(newTokens, candidateTokens);
      const hoursDiff = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
      const decayFactor = Math.exp(-hoursDiff / 24);
      const overlapFactor = overlap < 0.15 ? 0.8 : overlap < 0.3 ? 0.92 : 1;
      const adjustedSim = row.similarity * decayFactor * overlapFactor;

      const current = storyBestSim.get(row.story_id) ?? 0;
      if (adjustedSim > current) {
        storyBestSim.set(row.story_id, adjustedSim);
      }
    }

    let bestStoryId: number | null = null;
    let bestSim = 0;
    for (const [storyId, sim] of storyBestSim) {
      if (sim > bestSim) {
        bestSim = sim;
        bestStoryId = storyId;
      }
    }

    if (bestStoryId != null && bestSim > CLUSTERING.similarityThreshold) {
      const [existingSources, currentCount, newSourceBias] = await Promise.all([
        db.execute<{ source_id: number; bias_rating: string }>(sql`
          SELECT DISTINCT a.source_id, s.bias_rating
          FROM articles a
          JOIN sources s ON s.id = a.source_id
          WHERE a.story_id = ${bestStoryId}
        `),
        db.execute<{ cnt: string }>(sql`
          SELECT COUNT(*)::text AS cnt FROM articles WHERE story_id = ${bestStoryId}
        `),
        db.execute<{ bias_rating: string }>(sql`
          SELECT bias_rating FROM sources WHERE id = ${sourceId} LIMIT 1
        `),
      ]);

      const sourceRows = existingSources.rows ?? [];
      const articleCount = Number(currentCount.rows?.[0]?.cnt ?? 0);

      if (articleCount >= MAX_CLUSTER_SIZE) {
        bestStoryId = null;
      }

      if (bestStoryId != null) {
        const sourceIds = new Set(sourceRows.map((r) => r.source_id));
        const newSourceCount = sourceIds.has(sourceId) ? sourceIds.size : sourceIds.size + 1;
        const newArticleCount = articleCount + 1;

        const biasGroups = new Set(sourceRows.map((r) => normalizeBiasGroup(r.bias_rating)));
        if (!sourceIds.has(sourceId) && newSourceBias.rows?.[0]) {
          biasGroups.add(normalizeBiasGroup(newSourceBias.rows[0].bias_rating));
        }

        const relevanceScore = computeRelevanceScore(newSourceCount, newArticleCount, biasGroups.size);

        await db
          .update(schema.stories)
          .set({
            articleCount: sql`article_count + 1`,
            sourceCount: newSourceCount,
            relevanceScore,
            updatedAt: new Date(),
          })
          .where(eq(schema.stories.id, bestStoryId));

        return bestStoryId;
      }
    }
  }

  const [newStory] = await db
    .insert(schema.stories)
    .values({
      title: articleTitle, // This is now the LLM-generated headline from the summarizer
      articleCount: 1,
      sourceCount: 1,
      relevanceScore: computeRelevanceScore(1, 1, 1),
    })
    .returning({ id: schema.stories.id });

  return newStory.id;
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
