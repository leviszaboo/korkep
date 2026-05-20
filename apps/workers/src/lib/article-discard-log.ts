import { db, schema } from './db.js';
import { logger } from '../logger.js';
import type { TrashStage } from './article-trash.js';

export interface ArticleDiscardLogInput {
  sourceId: number | null;
  sourceSlug: string;
  url: string;
  title: string;
  category?: string | null;
  reason: string;
  ruleId: string;
  confidence: number;
  stage: TrashStage;
  publishedAt?: Date | null;
}

export async function logArticleDiscard(input: ArticleDiscardLogInput): Promise<void> {
  await logArticleDiscards([input]);
}

export async function logArticleDiscards(inputs: ArticleDiscardLogInput[]): Promise<void> {
  if (inputs.length === 0) return;

  try {
    await db
      .insert(schema.articleDiscardLog)
      .values(inputs.map((input) => ({
        sourceId: input.sourceId,
        sourceSlug: input.sourceSlug,
        url: input.url,
        title: input.title,
        category: input.category ?? null,
        reason: input.reason,
        ruleId: input.ruleId,
        confidence: input.confidence,
        stage: input.stage,
        publishedAt: input.publishedAt ?? null,
      })))
      .onConflictDoNothing({ target: schema.articleDiscardLog.url });
  } catch (err) {
    logger.warn({ err, count: inputs.length }, 'Failed to write article discard log');
  }
}

