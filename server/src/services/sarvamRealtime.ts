/**
 * Sarvam realtime STT (saaras:v4) helpers: URL builder and an event normaliser that turns
 * Sarvam's wire events into the small protocol our browser client understands
 * (see docs/PLAN.md section 8).
 */

export const SARVAM_REALTIME_URL = 'wss://api.sarvam.ai/speech-to-text-realtime/ws';
export const STT_MODEL = 'saaras:v4';
export const SAMPLE_RATE = 16_000;

export interface RealtimeOptions {
  languageCode: string;
  mode: string;
}

export function buildRealtimeUrl(
  { languageCode, mode }: RealtimeOptions,
  base = SARVAM_REALTIME_URL,
) {
  const url = new URL(base);
  url.search = new URLSearchParams({
    model: STT_MODEL,
    language_code: languageCode,
    mode,
    stream_type: 'balanced',
    endpointing: 'vad',
    encoding: 'linear16',
    sample_rate: String(SAMPLE_RATE),
  }).toString();
  return url.toString();
}

export type ClientEvent =
  | { type: 'partial'; text: string; language?: string }
  | { type: 'final'; text: string; language?: string }
  | { type: 'speech_start' }
  | { type: 'speech_end' }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'session_end'; audioDurationS?: number };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Reads a field from the event itself or from a nested `data` object. */
function field(msg: Json, ...names: string[]): unknown {
  const data = isObject(msg.data) ? msg.data : {};
  for (const n of names) {
    if (msg[n] !== undefined) return msg[n];
    if (data[n] !== undefined) return data[n];
  }
  return undefined;
}

/** Maps one Sarvam message to a client event, or null if the client doesn't need it. */
export function normalizeSarvamEvent(raw: unknown): ClientEvent | null {
  if (!isObject(raw)) return null;
  const event = str(raw.event) ?? str(raw.type);

  switch (event) {
    case 'transcript.partial':
    case 'transcript.final': {
      const text = str(field(raw, 'text', 'transcript')) ?? '';
      const language = str(field(raw, 'language', 'language_code'));
      const type = event === 'transcript.final' ? 'final' : 'partial';
      return language ? { type, text, language } : { type, text };
    }
    case 'vad.speech_start':
      return { type: 'speech_start' };
    case 'vad.speech_end':
      return { type: 'speech_end' };
    case 'session.end': {
      const d = field(raw, 'audio_duration_s');
      return typeof d === 'number'
        ? { type: 'session_end', audioDurationS: d }
        : { type: 'session_end' };
    }
    case 'error': {
      const message = str(field(raw, 'message', 'error')) ?? 'Speech service error';
      const fatal = field(raw, 'is_fatal') !== false;
      return { type: 'error', message, fatal };
    }
    default:
      return null; // session.begin, pong, config.updated…
  }
}

/** Human-readable reason for an upstream close code. */
export function describeUpstreamClose(code: number): string {
  switch (code) {
    case 1003:
      return 'Speech service rejected the request (key, rate limit or quota)';
    case 1008:
      return 'Speech service closed the session after 60 s without audio';
    case 1011:
      return 'Speech service had an internal error, please try again';
    case 4000:
      return 'Speech service rejected a parameter (language or mode)';
    default:
      return `Speech service closed the connection (code ${code})`;
  }
}
