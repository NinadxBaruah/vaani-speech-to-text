import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';
import { withStrictSsl } from './src/db/client.js';

// drizzle-kit runs from server/ and loads this file as CommonJS (no import.meta).
const rootEnv = resolve(process.cwd(), '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: withStrictSsl(process.env.DB_URI ?? 'postgresql://localhost/unset') },
  strict: true,
});
