import 'dotenv/config';

function parseIntInRange(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = raw == null || raw.trim() === '' ? fallback : parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export const config = {
  server: {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 3001),
  },
  database: {
    url: process.env.DATABASE_URL ?? 'postgres://korkep:korkep@localhost:5432/korkep',
  },
  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  },
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== '0' && process.env.RATE_LIMIT_ENABLED !== 'false',
    max: parseIntInRange(process.env.RATE_LIMIT_MAX, 120, 1, 10_000),
    searchMax: parseIntInRange(process.env.SEARCH_RATE_LIMIT_MAX, 30, 1, 10_000),
    windowMs: parseIntInRange(process.env.RATE_LIMIT_WINDOW_SECONDS, 60, 1, 86_400) * 1000,
  },
} as const;
