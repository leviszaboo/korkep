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
    model: process.env.SUMMARIZER_MODEL ?? 'google/gemma-4-26b-a4b-it',
    openrouterModel: process.env.SUMMARIZER_OPENROUTER_MODEL ?? 'google/gemma-4-26b-a4b-it',
    storyModel: process.env.STORY_MODEL_OVERRIDE ?? process.env.STORY_MODEL ?? 'google/gemma-4-31b-it',
  },
  recluster: {
    reclusterFrequencyMinutes: parseInt(process.env.RECLUSTER_FREQUENCY_MINUTES ?? '30', 10),
    noCache: process.env.RECLUSTER_NO_CACHE === '1' || process.env.RECLUSTER_NO_CACHE === 'true',
    forceOpenRouter: process.env.FORCE_OPENROUTER === '1' || process.env.FORCE_OPENROUTER === 'true',
    llmConcurrency: parseInt(process.env.RECLUSTER_LLM_CONCURRENCY ?? '1', 10),
    postMergeThreshold: parseFloat(process.env.RECLUSTER_MERGE_THRESHOLD ?? '0.90'),
    postMergeMaxSize: parseInt(process.env.RECLUSTER_MERGE_MAX_SIZE ?? '24', 10),
  },
  process: {
    concurrency: parseInt(process.env.PROCESS_CONCURRENCY ?? '15', 10),
  },
  scrape: {
    llmConcurrency: parseInt(process.env.SCRAPE_LLM_CONCURRENCY ?? '1', 10),
  },
  repair: {
    analysisConcurrency: parseInt(process.env.REPAIR_ANALYSIS_CONCURRENCY ?? '1', 10),
  },
  googleAiStudio: {
    apiKey: process.env.GOOGLE_AI_STUDIO_API_KEY ?? '',
    model: process.env.GOOGLE_AI_STUDIO_MODEL ?? 'gemma-4-26b-a4b-it',
    maxPerMinute: 14,
    maxPerDay: 1450,
  },
  batchClusterer: {
    url: process.env.BATCH_CLUSTERER_URL ?? 'http://localhost:8101',
  },
} as const;
