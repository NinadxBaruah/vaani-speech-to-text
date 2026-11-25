import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_TTS_SPEAKER, TTS_LANGUAGE_CODES, TTS_SPEAKER_IDS } from '../lib/languages.js';
import type { TtsClient } from '../services/sarvamTts.js';

const TtsBody = z.object({
  text: z.string().trim().min(1).max(2500),
  languageCode: z.enum(TTS_LANGUAGE_CODES as [string, ...string[]]),
  speaker: z.enum(TTS_SPEAKER_IDS).default(DEFAULT_TTS_SPEAKER),
});

export async function ttsRoutes(app: FastifyInstance, { tts }: { tts: TtsClient }) {
  app.post(
    '/',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = TtsBody.parse(request.body);
      const audio = await tts(body);
      return reply
        .header('content-type', 'audio/wav')
        .header('cache-control', 'no-store')
        .send(audio);
    },
  );
}
