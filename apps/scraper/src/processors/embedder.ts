import { config } from '../config.js';
import { logger } from '../logger.js';

interface OpenRouterEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

const MAX_RETRIES = 3;

async function callOpenRouter(texts: string[]): Promise<number[][]> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt) * 500;
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.openrouter.apiKey}`,
        },
        body: JSON.stringify({
          model: config.openrouter.model,
          input: texts,
          encoding_format: 'float',
          dimensions: config.openrouter.dimensions,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        throw new Error(`OpenRouter returned ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as OpenRouterEmbedResponse;
      const sorted = data.data.sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    } catch (err) {
      lastError = err;
      logger.warn({ err, attempt: attempt + 1, texts: texts.length }, 'OpenRouter call failed, retrying');
    }
  }

  throw lastError;
}

const SUB_BATCH_SIZE = 20;
const MAX_CONCURRENCY = 15;

export async function getEmbedding(text: string): Promise<number[]> {
  const [embedding] = await callOpenRouter([text]);
  return embedding;
}

export async function getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length <= SUB_BATCH_SIZE) return callOpenRouter(texts);

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

        callOpenRouter(chunks[idx])
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
    resolve: (embedding: number[]) => void;
    reject: (err: unknown) => void;
  }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  embed(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      this.pending.push({ text, resolve, reject });
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

    getEmbeddingsBatch(batch.map((b) => b.text))
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
