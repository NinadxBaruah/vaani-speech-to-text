import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createEngines } from '../src/services/engines/index.js';
import type { LocalSttClient } from '../src/services/engines/localWhisper.js';
import { buildTestApp } from './fakes.js';

/**
 * Runs the real WS proxy against a fake "Sarvam" server and a fake self-hosted sidecar, so the
 * relay logic (auth, audio forwarding, flush/end on stop, event mapping, engine choice) is tested
 * without the network.
 */

let app: FastifyInstance;
let fakeSarvam: WebSocketServer;
let upstreamMessages: Array<Record<string, unknown>>;
let upstreamHeaders: Record<string, string | string[] | undefined>;
let upstreamUrl: string | undefined;
let base: string;
let localUp: boolean;
let localCalls: Array<{ beam: number; bytes: number }>;

const fakeLocal: LocalSttClient = {
  health: async () => localUp,
  transcribe: async (pcm, { beam }) => {
    localCalls.push({ beam, bytes: pcm.length });
    return beam === 1 ? 'kal ki' : 'kal ki meeting das baje hai';
  },
};

beforeEach(async () => {
  upstreamMessages = [];
  localUp = true;
  localCalls = [];
  fakeSarvam = new WebSocketServer({ port: 0 });
  fakeSarvam.on('connection', (socket, req) => {
    upstreamHeaders = req.headers;
    upstreamUrl = req.url;
    socket.send(JSON.stringify({ event: 'session.begin' }));
    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      upstreamMessages.push(msg);
      if (msg.event === 'audio_input' && upstreamMessages.length === 1) {
        socket.send(
          JSON.stringify({ event: 'transcript.partial', text: 'namaste', language: 'hi-IN' }),
        );
      }
      if (msg.event === 'flush') {
        socket.send(
          JSON.stringify({ event: 'transcript.final', text: 'नमस्ते दुनिया', language: 'hi-IN' }),
        );
      }
      if (msg.event === 'end') {
        socket.send(JSON.stringify({ event: 'session.end', audio_duration_s: 0.2 }));
        socket.close();
      }
    });
  });
  await new Promise((r) => fakeSarvam.once('listening', r));
  const port = (fakeSarvam.address() as AddressInfo).port;

  app = await buildTestApp({
    engines: createEngines({
      sarvamApiKey: 'test-key-not-real',
      sarvamRealtimeUrl: `ws://127.0.0.1:${port}/ws`,
      localClient: fakeLocal,
    }),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/transcribe`;
});

afterEach(async () => {
  await app.close();
  await new Promise((r) => fakeSarvam.close(r));
});

function collect(ws: WebSocket) {
  const events: Array<Record<string, unknown>> = [];
  const closed = new Promise<{ code: number }>((resolve) => {
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    ws.on('close', (code) => resolve({ code }));
  });
  return { events, closed };
}

async function open(url: string, start: Record<string, unknown>) {
  const ws = new WebSocket(url);
  const result = collect(ws);
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'start', ...start }));
  return { ws, ...result };
}

describe('live transcription proxy (Sarvam)', () => {
  it('relays audio and transcripts end to end', async () => {
    const { ws, events, closed } = await open(base, { languageCode: 'auto', mode: 'codemix' });
    ws.send(Buffer.alloc(3200)); // may arrive before upstream is open → buffered
    await new Promise((r) => setTimeout(r, 150));
    ws.send(Buffer.alloc(3200));
    await new Promise((r) => setTimeout(r, 50));
    ws.send(JSON.stringify({ type: 'stop' }));

    const { code } = await closed;
    expect(code).toBe(1000);
    expect(events.map((e) => e.type)).toEqual(['ready', 'partial', 'final', 'ended']);
    expect(events[0]).toMatchObject({ engine: 'sarvam' });
    expect(events[2]).toMatchObject({ text: 'नमस्ते दुनिया', language: 'hi-IN' });
    expect(events[3]).toMatchObject({ audioDurationS: 0.2 });

    // Key goes in a header to Sarvam, never in the URL; params are passed through.
    expect(upstreamHeaders['api-subscription-key']).toBe('test-key-not-real');
    expect(upstreamUrl).toContain('language_code=auto');
    expect(upstreamUrl).toContain('mode=codemix');
    expect(upstreamUrl).not.toContain('test-key');
    const kinds = upstreamMessages.map((m) => m.event);
    expect(kinds.filter((k) => k === 'audio_input')).toHaveLength(2);
    expect(kinds.slice(-2)).toEqual(['flush', 'end']);
    expect(typeof upstreamMessages[0]?.audio).toBe('string');
    expect(localCalls).toHaveLength(0);
  });

  it('rejects garbage control messages, unknown engines and odd-sized audio', async () => {
    const ws = new WebSocket(base);
    const { closed } = collect(ws);
    await new Promise((r) => ws.once('open', r));
    ws.send('not json');
    expect((await closed).code).toBe(4400);

    const bad = await open(base, { engine: 'gpt' });
    expect((await bad.closed).code).toBe(4400);

    const odd = await open(base, {});
    odd.ws.send(Buffer.alloc(3)); // not PCM16
    expect((await odd.closed).code).toBe(4400);
  });
});

/** PCM16 16 kHz: silence / loud tone / silence, the shape of one spoken utterance. */
function utteranceAudio(): Buffer {
  const samples = (s: number) => Math.round(s * 16_000);
  const [lead, speech, tail] = [samples(0.5), samples(1.6), samples(1.2)];
  const out = Buffer.alloc((lead + speech + tail) * 2);
  for (let i = 0; i < speech; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 220 * i) / 16_000) * 0.3 * 32767);
    out.writeInt16LE(v, (lead + i) * 2);
  }
  return out;
}

describe('self-hosted engine (Whisper sidecar)', () => {
  it('segments speech and returns the final Hinglish text', async () => {
    const { ws, events, closed } = await open(base, { engine: 'local' });
    const audio = utteranceAudio();
    for (let i = 0; i < audio.length; i += 3200) {
      ws.send(audio.subarray(i, i + 3200));
      await new Promise((r) => setTimeout(r, 2));
    }
    ws.send(JSON.stringify({ type: 'stop' }));

    expect((await closed).code).toBe(1000);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('ready');
    expect(events[0]).toMatchObject({ engine: 'local' });
    expect(types).toContain('speech_start');
    expect(types).toContain('speech_end');
    expect(events.find((e) => e.type === 'final')).toMatchObject({
      text: 'kal ki meeting das baje hai',
    });
    expect(types.at(-1)).toBe('ended');
    expect(events.at(-1)).toMatchObject({ audioDurationS: 3.3 });

    // One beam-search final covering the voiced part (+ pre-roll), not the surrounding silence.
    const finalCalls = localCalls.filter((c) => c.beam === 5);
    expect(finalCalls).toHaveLength(1);
    const seconds = finalCalls[0]!.bytes / 32_000;
    expect(seconds).toBeGreaterThan(1.5);
    expect(seconds).toBeLessThan(2.4);
    expect(upstreamMessages).toHaveLength(0); // Sarvam never touched
  });

  it('fails cleanly when the sidecar is down', async () => {
    localUp = false;
    const { events, closed } = await open(base, { engine: 'local' });
    expect((await closed).code).toBe(4502);
    expect(events[0]).toMatchObject({ type: 'error', fatal: true });
    expect(String(events[0]?.message)).toMatch(/self-hosted/i);
  });

  it('reports engine availability in /api/meta', async () => {
    const meta = (await app.inject('/api/meta')).json<{
      engines: Array<{ id: string; available: boolean; kind: string }>;
    }>();
    expect(meta.engines.map((e) => [e.id, e.kind, e.available])).toEqual([
      ['sarvam', 'third-party', true],
      ['local', 'self-hosted', true],
    ]);
  });

  it('rejects the local engine with 4503 when no sidecar is configured', async () => {
    const plain = await buildTestApp();
    await plain.listen({ port: 0, host: '127.0.0.1' });
    try {
      const port = (plain.server.address() as AddressInfo).port;
      const { closed } = await open(`ws://127.0.0.1:${port}/api/transcribe`, { engine: 'local' });
      expect((await closed).code).toBe(4503);
      const meta = (await plain.inject('/api/meta')).json<{
        engines: Array<{ id: string; available: boolean }>;
      }>();
      expect(meta.engines.find((e) => e.id === 'local')?.available).toBe(false);
    } finally {
      await plain.close();
    }
  });
});
