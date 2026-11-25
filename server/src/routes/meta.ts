import type { FastifyInstance } from 'fastify';
import {
  AUTO_LANGUAGE,
  STT_LANGUAGES,
  STT_MODES,
  TTS_LANGUAGES,
  TTS_SPEAKERS,
} from '../lib/languages.js';
import type { Engines } from '../services/engines/index.js';
import { STT_MODEL } from '../services/sarvamRealtime.js';

export async function metaRoutes(app: FastifyInstance, { engines }: { engines: Engines }) {
  app.get('/', async (_request, reply) => {
    // Short cache: engine availability (self-hosted sidecar up/down) can change.
    reply.header('cache-control', 'public, max-age=30');
    return {
      sttModel: STT_MODEL,
      autoLanguage: AUTO_LANGUAGE,
      engines: await engines.status(),
      sttLanguages: STT_LANGUAGES,
      ttsLanguages: TTS_LANGUAGES,
      modes: STT_MODES,
      ttsSpeakers: TTS_SPEAKERS,
    };
  });
}
