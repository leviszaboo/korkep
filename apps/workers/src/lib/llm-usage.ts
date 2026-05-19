import { db, schema } from './db.js';
import { logger } from '../logger.js';

const enabled = process.env.LLM_USAGE_LOG !== '0';

export type TriggerMode = 'scheduled' | 'manual';

export type LlmStage =
  | 'process'
  | 'embed'
  | 'recluster'
  | 'repair'
  | 'resummarize'
  | 'reembed';

export type LlmOperation = 'summarize' | 'embedding' | 'storytitle';

export type LlmActivity = `${TriggerMode}_${LlmStage}_${LlmOperation}`;

export function buildActivity(
  trigger: TriggerMode,
  stage: LlmStage,
  operation: LlmOperation,
): LlmActivity {
  return `${trigger}_${stage}_${operation}`;
}

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
