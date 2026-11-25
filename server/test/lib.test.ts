import { describe, expect, it } from 'vitest';
import { withStrictSsl } from '../src/db/client.js';
import {
  generateWorkspaceKey,
  hashWorkspaceKey,
  isWellFormedKey,
  keyDisplayPrefix,
  parseBearer,
} from '../src/lib/apiKey.js';
import { titleFromText } from '../src/routes/transcripts.js';
import {
  buildRealtimeUrl,
  describeUpstreamClose,
  normalizeSarvamEvent,
} from '../src/services/sarvamRealtime.js';

describe('workspace keys', () => {
  it('generates unique, well-formed keys', () => {
    const a = generateWorkspaceKey();
    const b = generateWorkspaceKey();
    expect(a).not.toBe(b);
    expect(isWellFormedKey(a)).toBe(true);
    expect(a.startsWith('stt_')).toBe(true);
  });

  it('rejects malformed keys', () => {
    expect(isWellFormedKey('stt_short')).toBe(false);
    expect(isWellFormedKey(`xyz_${'a'.repeat(43)}`)).toBe(false);
    expect(isWellFormedKey('')).toBe(false);
  });

  it('hashes deterministically to 64 hex chars', () => {
    const key = generateWorkspaceKey();
    expect(hashWorkspaceKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashWorkspaceKey(key)).toBe(hashWorkspaceKey(key));
    expect(keyDisplayPrefix(key)).toHaveLength(10);
  });

  it('parses bearer headers', () => {
    expect(parseBearer('Bearer abc')).toBe('abc');
    expect(parseBearer('bearer   abc ')).toBe('abc');
    expect(parseBearer('Basic abc')).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
  });
});

describe('sarvam realtime helpers', () => {
  it('builds the realtime URL with saaras:v4 and 16 kHz PCM', () => {
    const url = new URL(buildRealtimeUrl({ languageCode: 'auto', mode: 'codemix' }));
    expect(url.host).toBe('api.sarvam.ai');
    expect(url.searchParams.get('model')).toBe('saaras:v4');
    expect(url.searchParams.get('language_code')).toBe('auto');
    expect(url.searchParams.get('mode')).toBe('codemix');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('encoding')).toBe('linear16');
  });

  it('normalises transcript events (flat and nested)', () => {
    expect(
      normalizeSarvamEvent({ event: 'transcript.partial', text: 'namaste', language: 'hi-IN' }),
    ).toEqual({ type: 'partial', text: 'namaste', language: 'hi-IN' });
    expect(
      normalizeSarvamEvent({ event: 'transcript.final', data: { transcript: 'नमस्ते' } }),
    ).toEqual({ type: 'final', text: 'नमस्ते' });
  });

  it('normalises VAD, session end and errors; ignores the rest', () => {
    expect(normalizeSarvamEvent({ event: 'vad.speech_start' })).toEqual({ type: 'speech_start' });
    expect(normalizeSarvamEvent({ event: 'session.end', audio_duration_s: 3.2 })).toEqual({
      type: 'session_end',
      audioDurationS: 3.2,
    });
    expect(
      normalizeSarvamEvent({ event: 'error', code: 'x', message: 'bad', is_fatal: false }),
    ).toEqual({ type: 'error', message: 'bad', fatal: false });
    expect(normalizeSarvamEvent({ event: 'session.begin' })).toBeNull();
    expect(normalizeSarvamEvent('nope')).toBeNull();
  });

  it('describes upstream close codes', () => {
    expect(describeUpstreamClose(1003)).toMatch(/key|quota/);
    expect(describeUpstreamClose(4999)).toMatch(/4999/);
  });
});

describe('helpers', () => {
  it('derives a title from the first words', () => {
    expect(titleFromText('one two three')).toBe('one two three');
    expect(titleFromText('a b c d e f g h i j')).toBe('a b c d e f g h…');
  });

  it('pins sslmode=require to verify-full', () => {
    expect(withStrictSsl('postgresql://u:p@h/db?sslmode=require')).toContain('sslmode=verify-full');
    expect(withStrictSsl('postgresql://u:p@h/db')).not.toContain('sslmode');
  });
});
