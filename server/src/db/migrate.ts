import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { env } from '../config/env.js';
import { createDb } from './client.js';

// Works from both src/db (tsx) and dist/db (compiled): migrations live in server/drizzle.
const migrationsFolder = resolve(import.meta.dirname, '..', '..', 'drizzle');

const { db, pool } = createDb(env.DB_URI);
try {
  await migrate(db, { migrationsFolder });
  console.log('Database migrations applied.');
} catch (err) {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
