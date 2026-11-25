import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { createDb } from './db/client.js';
import { createTranscriptRepository } from './repositories/transcripts.js';
import { createWorkspaceRepository } from './repositories/workspaces.js';
import { createEngines } from './services/engines/index.js';
import { createSarvamTts } from './services/sarvamTts.js';

const { db, pool } = createDb(env.DB_URI);
const isProd = env.NODE_ENV === 'production';

const app = await buildApp({
  repos: {
    workspaces: createWorkspaceRepository(db),
    transcripts: createTranscriptRepository(db),
  },
  tts: createSarvamTts(env.SARVAM_API_KEY),
  checkDb: async () => {
    await db.execute(sql`select 1`);
    return true;
  },
  engines: createEngines({
    sarvamApiKey: env.SARVAM_API_KEY,
    ...(env.LOCAL_STT_URL ? { localSttUrl: env.LOCAL_STT_URL } : {}),
  }),
  maxSessionSeconds: env.MAX_SESSION_SECONDS,
  staticDir: resolve(import.meta.dirname, '..', '..', 'web', 'dist'),
  trustProxy: isProd,
  logger: {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.key'],
    ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
  },
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  await pool.end();
  process.exit(1);
}
