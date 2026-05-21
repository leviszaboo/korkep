import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../../lib/db.js';
import type { StoryTitleResult } from '../summarizer.js';

export interface DecisionCacheRowInput {
  articleIds: number[];
  model: string;
  result: StoryTitleResult;
}

export interface DecisionCacheRow {
  fingerprint: string;
  articleIds: number[];
  coherent: boolean;
  title: string | null;
  summary: string | null;
  groups: number[][] | null;
  model: string;
}

export function buildDecisionCacheFingerprint(articleIds: number[]): string {
  return articleIds.slice().sort((a, b) => a - b).join(',');
}

export function decisionToCacheRow(input: DecisionCacheRowInput): DecisionCacheRow {
  const articleIds = input.articleIds.slice().sort((a, b) => a - b);
  const fingerprint = buildDecisionCacheFingerprint(articleIds);

  if (input.result.coherent) {
    return {
      fingerprint,
      articleIds,
      coherent: true,
      title: input.result.title,
      summary: input.result.summary,
      groups: null,
      model: input.model,
    };
  }

  return {
    fingerprint,
    articleIds,
    coherent: false,
    title: null,
    summary: null,
    groups: input.result.groups,
    model: input.model,
  };
}

export function cacheRowToDecision(row: {
  coherent: boolean;
  title: string | null;
  summary: string | null;
  groups: unknown;
}): StoryTitleResult | null {
  if (row.coherent) {
    if (!row.title) return null;
    return { coherent: true, title: row.title, summary: row.summary };
  }

  if (!Array.isArray(row.groups)) return null;
  const groups = row.groups
    .map((group) => Array.isArray(group) ? group.map(Number).filter(Number.isFinite) : [])
    .filter((group) => group.length > 0);

  return groups.length >= 2 ? { coherent: false, groups } : null;
}

export async function getCachedReclusterDecision(
  fingerprint: string,
): Promise<StoryTitleResult | null> {
  const [row] = await db
    .select({
      coherent: schema.reclusterDecisionCache.coherent,
      title: schema.reclusterDecisionCache.title,
      summary: schema.reclusterDecisionCache.summary,
      groups: schema.reclusterDecisionCache.groups,
    })
    .from(schema.reclusterDecisionCache)
    .where(eq(schema.reclusterDecisionCache.fingerprint, fingerprint))
    .limit(1);

  const decision = row ? cacheRowToDecision(row) : null;
  if (decision) {
    await db
      .update(schema.reclusterDecisionCache)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.reclusterDecisionCache.fingerprint, fingerprint));
  }

  return decision;
}

export async function storeReclusterDecision(input: DecisionCacheRowInput): Promise<void> {
  const row = decisionToCacheRow(input);

  await db
    .insert(schema.reclusterDecisionCache)
    .values({
      fingerprint: row.fingerprint,
      articleIds: row.articleIds,
      coherent: row.coherent,
      title: row.title,
      summary: row.summary,
      groups: row.groups,
      model: row.model,
      lastUsedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.reclusterDecisionCache.fingerprint,
      set: {
        articleIds: row.articleIds,
        coherent: row.coherent,
        title: row.title,
        summary: row.summary,
        groups: row.groups,
        model: row.model,
        lastUsedAt: new Date(),
      },
    });
}

export type IncoherentOverlapLookup = (articleIds: number[]) => Promise<Array<{
  articleIds: number[];
  groups: number[][];
}>>;

export async function hasPriorIncoherentOverlap(
  articleIds: number[],
  lookup: IncoherentOverlapLookup,
): Promise<{ blocked: false } | { blocked: true; reason: string; splitGroups: number[][] }> {
  const sortedArticleIds = articleIds.slice().sort((a, b) => a - b);
  const rows = await lookup(sortedArticleIds);
  const currentSet = new Set(articleIds);

  for (const row of rows) {
    if (row.groups.length < 2) continue;
    const priorIds = row.articleIds.filter((id) => currentSet.has(id));
    if (priorIds.length >= 2) {
      return {
        blocked: true,
        reason: `prior incoherent decision split articles ${priorIds.join(',')}`,
        splitGroups: row.groups,
      };
    }
  }
  return { blocked: false };
}

export async function getPriorIncoherentOverlaps(articleIds: number[]) {
  const rows = await db
    .select({
      articleIds: schema.reclusterDecisionCache.articleIds,
      groups: schema.reclusterDecisionCache.groups,
    })
    .from(schema.reclusterDecisionCache)
    .where(sql`
      coherent = false
      AND article_ids && ${articleIds}::int[]
    `);

  return rows
    .filter((row) => row.groups && row.groups.length >= 2)
    .map((row) => ({ articleIds: row.articleIds, groups: row.groups! }));
}
