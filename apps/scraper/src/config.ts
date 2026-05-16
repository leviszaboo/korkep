import 'dotenv/config';

export const config = {
  database: {
    url: process.env.DATABASE_URL ?? 'postgres://korkep:korkep@localhost:5432/korkep',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    model: process.env.EMBEDDING_MODEL ?? 'qwen/qwen3-embedding-8b',
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? '1024', 10),
  },
  summarizer: {
    model: process.env.SUMMARIZER_MODEL ?? 'google/gemini-2.5-flash-lite',
  },
  clusterer: {
    url: process.env.CLUSTERER_URL ?? 'http://localhost:8101',
  },
} as const;
