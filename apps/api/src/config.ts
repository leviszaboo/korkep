import 'dotenv/config';

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
} as const;
