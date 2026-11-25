import { badGateway } from '../lib/errors.js';

const TTS_URL = 'https://api.sarvam.ai/text-to-speech';

export interface TtsRequest {
  text: string;
  languageCode: string;
  speaker: string;
}

export type TtsClient = (req: TtsRequest) => Promise<Buffer>;

/** Calls Sarvam bulbul:v3 and returns WAV bytes. */
export function createSarvamTts(apiKey: string): TtsClient {
  return async ({ text, languageCode, speaker }) => {
    let res: Response;
    try {
      res = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'api-subscription-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          target_language_code: languageCode,
          speaker,
          model: 'bulbul:v3',
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw badGateway('Text-to-speech service is unreachable');
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw badGateway(
        `Text-to-speech failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }

    const body = (await res.json()) as { audios?: unknown };
    const audio = Array.isArray(body.audios) ? body.audios[0] : undefined;
    if (typeof audio !== 'string' || !audio) throw badGateway('Text-to-speech returned no audio');
    return Buffer.from(audio, 'base64');
  };
}
