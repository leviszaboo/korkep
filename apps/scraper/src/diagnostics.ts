import { sql } from 'drizzle-orm';
import { db, pool } from './lib/db.js';

async function main() {

  const [{ total_articles }] = await db.execute<{ total_articles: number }>(
    sql`SELECT count(*) as total_articles FROM articles`,
  ).then((r) => r.rows ?? [{ total_articles: 0 }]);

  const [{ total_stories }] = await db.execute<{ total_stories: number }>(
    sql`SELECT count(*) as total_stories FROM stories`,
  ).then((r) => r.rows ?? [{ total_stories: 0 }]);

  const [{ with_embedding }] = await db.execute<{ with_embedding: number }>(
    sql`SELECT count(*) as with_embedding FROM articles WHERE embedding IS NOT NULL`,
  ).then((r) => r.rows ?? [{ with_embedding: 0 }]);

  const [{ orphaned }] = await db.execute<{ orphaned: number }>(
    sql`SELECT count(*) as orphaned FROM articles WHERE story_id IS NULL`,
  ).then((r) => r.rows ?? [{ orphaned: 0 }]);

  console.log('\n=== Cluster Diagnostics ===\n');
  console.log(`Total articles:        ${total_articles}`);
  console.log(`With embeddings:       ${with_embedding}`);
  console.log(`Without story:         ${orphaned}`);
  console.log(`Total stories:         ${total_stories}`);

  const distribution = await db.execute<{ article_count: number; story_count: number }>(
    sql`SELECT article_count, count(*) as story_count
        FROM stories
        GROUP BY article_count
        ORDER BY article_count`,
  );

  console.log('\n--- Articles per Story Distribution ---');
  for (const row of distribution.rows ?? []) {
    console.log(`  ${row.article_count} article(s): ${row.story_count} stories`);
  }

  const topStories = await db.execute<{ id: number; title: string; article_count: number; source_count: number }>(
    sql`SELECT id, title, article_count, source_count
        FROM stories
        ORDER BY article_count DESC
        LIMIT 10`,
  );

  console.log('\n--- Top 10 Largest Stories ---');
  for (const row of topStories.rows ?? []) {
    console.log(`  [${row.id}] ${row.article_count} articles, ${row.source_count} sources: ${row.title.slice(0, 80)}`);
  }

  const simStats = await db.execute<{ avg_sim: number; min_sim: number; max_sim: number }>(
    sql`SELECT
          avg(sim) as avg_sim,
          min(sim) as min_sim,
          max(sim) as max_sim
        FROM (
          SELECT 1 - (a1.embedding <=> a2.embedding) as sim
          FROM articles a1
          JOIN articles a2 ON a1.story_id = a2.story_id AND a1.id < a2.id
          WHERE a1.embedding IS NOT NULL
            AND a2.embedding IS NOT NULL
            AND a1.story_id IS NOT NULL
          LIMIT 1000
        ) pairs`,
  );

  if ((simStats.rows ?? []).length > 0 && simStats.rows![0].avg_sim != null) {
    const s = simStats.rows![0];
    console.log('\n--- Within-Story Similarity (sample of 1000 pairs) ---');
    console.log(`  Avg: ${Number(s.avg_sim).toFixed(4)}`);
    console.log(`  Min: ${Number(s.min_sim).toFixed(4)}`);
    console.log(`  Max: ${Number(s.max_sim).toFixed(4)}`);
  }

  const crossStats = await db.execute<{ avg_sim: number; min_sim: number; max_sim: number }>(
    sql`SELECT
          avg(sim) as avg_sim,
          min(sim) as min_sim,
          max(sim) as max_sim
        FROM (
          SELECT 1 - (a1.embedding <=> a2.embedding) as sim
          FROM articles a1
          JOIN articles a2 ON a1.story_id != a2.story_id AND a1.id < a2.id
          WHERE a1.embedding IS NOT NULL
            AND a2.embedding IS NOT NULL
            AND a1.story_id IS NOT NULL
            AND a2.story_id IS NOT NULL
          LIMIT 1000
        ) pairs`,
  );

  if ((crossStats.rows ?? []).length > 0 && crossStats.rows![0].avg_sim != null) {
    const s = crossStats.rows![0];
    console.log('\n--- Cross-Story Similarity (sample of 1000 pairs) ---');
    console.log(`  Avg: ${Number(s.avg_sim).toFixed(4)}`);
    console.log(`  Min: ${Number(s.min_sim).toFixed(4)}`);
    console.log(`  Max: ${Number(s.max_sim).toFixed(4)}`);
  }

  console.log('');
  await pool.end();
}

main().catch((err) => {
  console.error('Diagnostics failed:', err);
  process.exit(1);
});
