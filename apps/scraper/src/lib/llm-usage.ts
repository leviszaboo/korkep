import { db, schema } from './db.js';
import { logger } from '../logger.js';

const enabled = process.env.LLM_USAGE_LOG !== '0';

export type LlmActivity =
  | 'scrape_summarize'
  | 'scrape_embed'
  | 'manual_resummarize'
  | 'manual_recluster'
  | 'manual_reembed'
  | 'scheduled_recluster'
  | 'scheduled_summarize'
  | 'scheduled_repair';

export function logLlmUsage(params: {
  provider: string;
  model: string;
  operation: string;
  activity: LlmActivity;
  promptTokens?: number | null;
  completionTokens?: number | null;
}): void {
  if (!enabled) return;

  const totalTokens =
    params.promptTokens != null && params.completionTokens != null
      ? params.promptTokens + params.completionTokens
      : null;

  db.insert(schema.llmUsageLog)
    .values({
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      activity: params.activity,
      promptTokens: params.promptTokens ?? null,
      completionTokens: params.completionTokens ?? null,
      totalTokens,
    })
    .catch((err) => {
      logger.warn({ err }, 'Failed to log LLM usage');
    });
}
