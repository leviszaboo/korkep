import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { config } from '../config.js';

const pool = new pg.Pool({
  connectionString: config.database.url,
});

export const db = drizzle(pool, { schema });
export { pool };
export { schema };
