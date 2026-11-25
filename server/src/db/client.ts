import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>['db'];

/**
 * pg currently treats sslmode=require as verify-full and warns that this will change.
 * Pin verify-full explicitly: same (strict) behaviour today, no surprise downgrade tomorrow.
 */
export function withStrictSsl(connectionString: string): string {
  const url = new URL(connectionString);
  const mode = url.searchParams.get('sslmode');
  if (mode === 'prefer' || mode === 'require' || mode === 'verify-ca') {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}

export function createDb(connectionString: string) {
  const pool = new pg.Pool({
    connectionString: withStrictSsl(connectionString),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}
