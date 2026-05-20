import 'dotenv/config';

export function parseIntInRange(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = raw == null || raw.trim() === '' ? fallback : parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export const config = {
  database: {
    url: process.env.DATABASE_URL ?? 'postgres://korkep:korkep@localhost:5432/korkep',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  pipeline: {
    autoChain: process.env.AUTO_CHAIN === 'true' || process.env.AUTO_CHAIN === '1',
    nextJob: process.env.NEXT_JOB ?? '',
    triggerMode: (process.env.TRIGGER_MODE ?? 'manual') as 'scheduled' | 'manual',
    gcpProjectId: process.env.GCP_PROJECT_ID ?? 'news-portal-496720',
    gcpRegion: process.env.GCP_REGION ?? 'us-central1',
  },
  scrape: {
    concurrency: parseIntInRange(process.env.SCRAPE_CONCURRENCY, 10, 1, 20),
    extractConcurrency: parseIntInRange(process.env.SCRAPE_EXTRACT_CONCURRENCY, 3, 1, 10),
    maxArticlesPerSource: parseIntInRange(process.env.MAX_ARTICLES_PER_SOURCE, 50, 1, 200),
  },
  llm: {
    concurrency: parseIntInRange(process.env.LLM_CONCURRENCY, 1, 1, 15),
    batchSize: parseIntInRange(process.env.PROCESS_BATCH_SIZE, 50, 1, 200),
    requestTimeoutMs: parseIntInRange(process.env.LLM_REQUEST_TIMEOUT_MS, 45_000, 5_000, 180_000),
    provider: (process.env.LLM_PROVIDER ?? 'gemini-fallback') as 'openrouter' | 'gemini-fallback',
    model: process.env.LLM_MODEL ?? 'google/gemma-4-26b-a4b-it',
  },
  embedding: {
    concurrency: parseIntInRange(process.env.EMBEDDING_CONCURRENCY, 10, 1, 20),
    batchSize: parseIntInRange(process.env.EMBEDDING_BATCH_SIZE, 50, 1, 200),
    storyConcurrency: parseIntInRange(process.env.STORY_ASSIGN_CONCURRENCY, 2, 1, 5),
    storyAssignLookbackHours: parseIntInRange(
      process.env.STORY_ASSIGN_LOOKBACK_HOURS ?? process.env.CLUSTER_TIME_WINDOW_HOURS,
      24,
      1,
      168,
    ),
    requestTimeoutMs: parseIntInRange(process.env.EMBEDDING_REQUEST_TIMEOUT_MS, 45_000, 5_000, 180_000),
    model: process.env.EMBEDDING_MODEL ?? 'qwen/qwen3-embedding-8b',
    dimensions: parseIntInRange(process.env.EMBEDDING_DIMENSIONS, 1024, 128, 4096),
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
  },
  googleAiStudio: {
    apiKey: process.env.GOOGLE_AI_STUDIO_API_KEY ?? '',
    model: process.env.GOOGLE_AI_STUDIO_MODEL ?? 'gemma-4-26b-a4b-it',
    maxPerMinute: 14,
    maxPerDay: 1450,
  },
  recluster: {
    seedHours: parseIntInRange(
      process.env.RECLUSTER_SEED_HOURS ?? process.env.CLUSTER_TIME_WINDOW_HOURS,
      24,
      1,
      168,
    ),
    noCache: process.env.RECLUSTER_NO_CACHE === '1' || process.env.RECLUSTER_NO_CACHE === 'true',
    llmConcurrency: parseIntInRange(process.env.RECLUSTER_LLM_CONCURRENCY, 1, 1, 15),
    llmProvider: (process.env.RECLUSTER_LLM_PROVIDER ?? 'gemini-fallback') as 'openrouter' | 'gemini-fallback',
    llmModel: process.env.RECLUSTER_LLM_MODEL ?? 'google/gemma-4-31b-it',
    postMergeThreshold: parseFloat(process.env.RECLUSTER_MERGE_THRESHOLD ?? '0.97'),
    postMergeMaxSize: parseIntInRange(process.env.RECLUSTER_MERGE_MAX_SIZE, 24, 2, 100),
  },
  repair: {
    analysisConcurrency: parseIntInRange(process.env.REPAIR_ANALYSIS_CONCURRENCY, 1, 1, 10),
    lookbackHours: parseIntInRange(process.env.REPAIR_LOOKBACK_HOURS, 24, 1, 168),
    maxArticles: parseIntInRange(process.env.REPAIR_MAX_ARTICLES, 100, 0, 1000),
    maxStories: parseIntInRange(process.env.REPAIR_MAX_STORIES, 50, 0, 500),
    embeddingBatchSize: parseIntInRange(process.env.REPAIR_EMBEDDING_BATCH_SIZE, 50, 1, 200),
    graceMinutes: parseIntInRange(process.env.REPAIR_GRACE_MINUTES, 90, 0, 1440),
  },
  batchClusterer: {
    url: process.env.BATCH_CLUSTERER_URL ?? 'http://localhost:8101',
  },
} as const;
