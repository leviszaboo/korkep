import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://korkep:korkep@localhost:5432/korkep',
  });

  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('pgvector extension enabled');
  } finally {
    client.release();
  }

  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations complete');

  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
