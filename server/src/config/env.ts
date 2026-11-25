import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load the repo-root .env (if present) using Node's built-in loader.
// Real environment variables always win over the file.
const rootEnv = resolve(import.meta.dirname, '..', '..', '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DB_URI: z.string().url(),
  SARVAM_API_KEY: z.string().min(10),
  /** Base URL of the self-hosted Whisper sidecar (stt-local). Unset = engine disabled. */
  LOCAL_STT_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  MAX_SESSION_SECONDS: z.coerce.number().int().min(10).max(3600).default(600),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    // Never echo values: they are secrets.
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return parsed.data;
}

export const env = loadEnv();
