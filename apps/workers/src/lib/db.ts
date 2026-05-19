import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@korkep/api/db/schema';
import { config } from '../config.js';

const pool = new pg.Pool({ connectionString: config.database.url, max: 30 });

export const db = drizzle(pool, { schema });
export { pool, schema };
