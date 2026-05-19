import { OpenRouter } from '@openrouter/sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { logLlmUsage, type LlmActivity } from '../lib/llm-usage.js';

const openrouter = new OpenRouter({ apiKey: config.openrouter.apiKey });

const MAX_RETRIES = 3;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callOpenRouter(texts: string[], activity: LlmActivity): Promise<number[][]> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt) * 500;
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const response = await withTimeout(openrouter.embeddings.generate({
        requestBody: {
          model: config.embedding.model,
          input: texts,
          encodingFormat: 'float',
          dimensions: config.embedding.dimensions,
        },
      }), config.embedding.requestTimeoutMs, 'OpenRouter embeddings');

      if (typeof response === 'string') {
        throw new Error(`Unexpected string response from OpenRouter embeddings`);
      }

      const promptTokens = (response as any).usage?.prompt_tokens ?? (response as any).usage?.promptTokens;
      logLlmUsage({
        provider: 'openrouter',
        mode: 'openrouter',
        model: config.embedding.model,
        operation: 'embedding',
        activity,
        promptTokens,
        completionTokens: 0,
      });

      const sorted = response.data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return sorted.map((d) => d.embedding as number[]);
    } catch (err) {
      lastError = err;
      logger.warn({ err, attempt: attempt + 1, texts: texts.length }, 'OpenRouter call failed, retrying');
    }
  }

  throw lastError;
}

const SUB_BATCH_SIZE = 20;
const MAX_CONCURRENCY = config.embedding.concurrency;

export async function getEmbedding(text: string, activity: LlmActivity): Promise<number[]> {
  const [embedding] = await callOpenRouter([text], activity);
  return embedding;
}

export async function getEmbeddingsBatch(texts: string[], activity: LlmActivity): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length <= SUB_BATCH_SIZE) return callOpenRouter(texts, activity);

  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += SUB_BATCH_SIZE) {
    chunks.push(texts.slice(i, i + SUB_BATCH_SIZE));
  }

  const results = new Array<number[][]>(chunks.length);
  let running = 0;
  let nextChunk = 0;

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    function launch() {
      while (running < MAX_CONCURRENCY && nextChunk < chunks.length) {
        const idx = nextChunk++;
        running++;

        callOpenRouter(chunks[idx], activity)
          .then((embeddings) => {
            results[idx] = embeddings;
            running--;
            if (nextChunk >= chunks.length && running === 0 && !settled) {
              settled = true;
              resolve();
            } else {
              launch();
            }
          })
          .catch((err) => {
            if (!settled) {
              settled = true;
              reject(err);
            }
          });
      }
    }

    launch();
  });

  return results.flat();
}

class EmbeddingBatcher {
  private pending: Array<{
    text: string;
    activity: LlmActivity;
    resolve: (embedding: number[]) => void;
    reject: (err: unknown) => void;
  }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  embed(text: string, activity: LlmActivity): Promise<number[]> {
    return new Promise((resolve, reject) => {
      this.pending.push({ text, activity, resolve, reject });
      if (this.pending.length >= 10) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), 150);
      }
    });
  }

  private flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.pending.splice(0);
    if (batch.length === 0) return;

    const activity = batch[0].activity;
    getEmbeddingsBatch(batch.map((b) => b.text), activity)
      .then((embeddings) => {
        for (let i = 0; i < batch.length; i++) {
          batch[i].resolve(embeddings[i]);
        }
      })
      .catch((err) => {
        for (const b of batch) b.reject(err);
      });
  }
}

export const embeddingBatcher = new EmbeddingBatcher();
