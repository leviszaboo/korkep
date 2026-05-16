import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { SOURCES } from '@korkep/shared';
import { sources } from '../src/db/schema.js';

async function main() {
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://korkep:korkep@localhost:5432/korkep',
  });

  const db = drizzle(pool);

  for (const s of SOURCES) {
    await db
      .insert(sources)
      .values({
        name: s.name,
        slug: s.slug,
        url: s.url,
        rssUrl: s.rssUrl ?? null,
        biasRating: s.biasRating,
        logoUrl: s.logoUrl ?? null,
      })
      .onConflictDoNothing({ target: sources.slug });

    if (s.logoUrl) {
      await db
        .update(sources)
        .set({ logoUrl: s.logoUrl })
        .where(eq(sources.slug, s.slug));
    }
  }

  console.log(`Seeded ${SOURCES.length} sources`);
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
