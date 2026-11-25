import { existsSync } from 'node:fs';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { errorHandler } from './lib/errors.js';
import type { Repositories } from './repositories/types.js';
import { healthRoutes } from './routes/health.js';
import { metaRoutes } from './routes/meta.js';
import { transcribeRoutes } from './routes/transcribe.js';
import { transcriptRoutes } from './routes/transcripts.js';
import { ttsRoutes } from './routes/tts.js';
import type { Engines } from './services/engines/index.js';
import type { TtsClient } from './services/sarvamTts.js';

export interface AppDeps {
  repos: Repositories;
  tts: TtsClient;
  checkDb: () => Promise<boolean>;
  engines: Engines;
  maxSessionSeconds: number;
  /** Absolute path of the built SPA (web/dist). Served with an index.html fallback when present. */
  staticDir?: string;
  logger?: FastifyServerOptions['logger'];
  /** Trust X-Forwarded-* headers (behind Caddy/nginx on EC2). */
  trustProxy?: boolean;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: deps.trustProxy ?? false,
    bodyLimit: 256 * 1024,
  });

  app.setErrorHandler(errorHandler);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // TLS is terminated by the reverse proxy; don't force-upgrade when someone tests over plain http.
        upgradeInsecureRequests: null,
      },
    },
    // Microphone is the whole point of the app; everything else stays off.
    crossOriginEmbedderPolicy: false,
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('permissions-policy', 'microphone=(self), camera=(), geolocation=()');
  });

  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 128 * 1024 } });

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { prefix: '/health', checkDb: deps.checkDb });
      await api.register(metaRoutes, { prefix: '/meta', engines: deps.engines });
      await api.register(transcriptRoutes, { prefix: '/transcripts', repos: deps.repos });
      await api.register(ttsRoutes, { prefix: '/tts', tts: deps.tts });
      await api.register(transcribeRoutes, {
        prefix: '/transcribe',
        engines: deps.engines.factories,
        maxSessionSeconds: deps.maxSessionSeconds,
      });
    },
    { prefix: '/api' },
  );

  if (deps.staticDir && existsSync(deps.staticDir)) {
    await app.register(fastifyStatic, {
      root: deps.staticDir,
      wildcard: false,
      maxAge: '1h',
      setHeaders(res, path) {
        // Vite fingerprints assets, so they can be cached forever; index.html must not be.
        if (/[\\/]assets[\\/]/.test(path)) {
          res.header('cache-control', 'public, max-age=31536000, immutable');
        } else if (path.endsWith('.html')) {
          res.header('cache-control', 'no-cache');
        }
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const wantsSpa =
      deps.staticDir &&
      request.method === 'GET' &&
      !request.url.startsWith('/api') &&
      (request.headers.accept ?? '').includes('text/html');
    if (wantsSpa) return reply.header('cache-control', 'no-cache').sendFile('index.html');
    return reply.status(404).send({
      error: { code: 'not_found', message: `Route ${request.method} ${request.url} not found` },
    });
  });

  return app;
}
