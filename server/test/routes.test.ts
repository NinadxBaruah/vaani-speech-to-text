import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from './fakes.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(async () => {
  await app.close();
});

async function newKey(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/workspaces' });
  expect(res.statusCode).toBe(201);
  return res.json<{ key: string }>().key;
}

const auth = (key: string) => ({ authorization: `Bearer ${key}` });

describe('meta & health', () => {
  it('reports health', async () => {
    const res = await app.inject('/api/health');
    expect(res.json()).toEqual({ ok: true, db: true });
  });

  it('lists every saaras:v4 language plus auto', async () => {
    const meta = (await app.inject('/api/meta')).json<{
      sttLanguages: unknown[];
      autoLanguage: string;
    }>();
    expect(meta.sttLanguages).toHaveLength(23);
    expect(meta.autoLanguage).toBe('auto');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await app.inject('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('workspaces', () => {
  it('creates a workspace and returns the key once, never the hash', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces' });
    const body = res.json();
    expect(body.key).toMatch(/^stt_/);
    expect(JSON.stringify(body)).not.toContain('keyHash');
    const me = await app.inject({ url: '/api/workspaces/me', headers: auth(body.key) });
    expect(me.json()).toMatchObject({ transcriptCount: 0, keyPrefix: body.key.slice(0, 10) });
  });

  it('rejects missing, malformed and unknown keys', async () => {
    expect((await app.inject('/api/transcripts')).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/transcripts', headers: auth('garbage') })).statusCode,
    ).toBe(401);
    const unknown = `stt_${'A'.repeat(43)}`;
    expect((await app.inject({ url: '/api/transcripts', headers: auth(unknown) })).statusCode).toBe(
      401,
    );
  });
});

describe('transcripts CRUD', () => {
  it('creates, reads, lists, searches, updates and deletes', async () => {
    const key = await newKey();
    const created = await app.inject({
      method: 'POST',
      url: '/api/transcripts',
      headers: auth(key),
      payload: {
        text: 'नमस्ते, kal ki meeting 10 baje hai',
        languageCode: 'auto',
        detectedLanguages: ['hi-IN', 'en-IN', 'hi-IN'],
        mode: 'codemix',
        durationMs: 3000,
      },
    });
    expect(created.statusCode).toBe(201);
    const t = created.json();
    expect(t.title).toBe('नमस्ते, kal ki meeting 10 baje hai');
    expect(t.detectedLanguages).toEqual(['hi-IN', 'en-IN']);

    const got = await app.inject({ url: `/api/transcripts/${t.id}`, headers: auth(key) });
    expect(got.json().text).toBe('नमस्ते, kal ki meeting 10 baje hai');

    const hit = await app.inject({ url: '/api/transcripts?q=MEETING', headers: auth(key) });
    expect(hit.json().total).toBe(1);
    const miss = await app.inject({ url: '/api/transcripts?q=zebra', headers: auth(key) });
    expect(miss.json().total).toBe(0);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/transcripts/${t.id}`,
      headers: auth(key),
      payload: { title: 'Meeting', text: 'Updated text' },
    });
    expect(patched.json()).toMatchObject({ title: 'Meeting', text: 'Updated text' });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/transcripts/${t.id}`,
      headers: auth(key),
    });
    expect(del.statusCode).toBe(204);
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/transcripts/${t.id}`,
      headers: auth(key),
    });
    expect(again.statusCode).toBe(404);
  });

  it('isolates workspaces from each other', async () => {
    const [a, b] = [await newKey(), await newKey()];
    const t = (
      await app.inject({
        method: 'POST',
        url: '/api/transcripts',
        headers: auth(a),
        payload: { text: 'secret' },
      })
    ).json();
    expect(
      (await app.inject({ url: `/api/transcripts/${t.id}`, headers: auth(b) })).statusCode,
    ).toBe(404);
    expect((await app.inject({ url: '/api/transcripts', headers: auth(b) })).json().total).toBe(0);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/transcripts/${t.id}`,
      headers: auth(b),
      payload: { text: 'hacked' },
    });
    expect(patch.statusCode).toBe(404);
  });

  it('validates input', async () => {
    const key = await newKey();
    const cases = [
      { text: '' },
      { text: 'ok', languageCode: 'xx-XX' },
      { text: 'ok', mode: 'shout' },
      { text: 'x'.repeat(20_001) },
    ];
    for (const payload of cases) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/transcripts',
        headers: auth(key),
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
      expect(res.json().error.code).toBe('validation_error');
    }
    const badId = await app.inject({ url: '/api/transcripts/not-a-uuid', headers: auth(key) });
    expect(badId.statusCode).toBe(400);
    const emptyPatch = await app.inject({
      method: 'PATCH',
      url: '/api/transcripts/7baab6e6-dd90-4619-b23b-c0be97ec860a',
      headers: auth(key),
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);
  });

  it('paginates newest first', async () => {
    const key = await newKey();
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/transcripts',
        headers: auth(key),
        payload: { text: `t${i}` },
      });
      await new Promise((r) => setTimeout(r, 2));
    }
    const page = (
      await app.inject({ url: '/api/transcripts?limit=2&offset=1', headers: auth(key) })
    ).json();
    expect(page.total).toBe(5);
    expect(page.items.map((t: { text: string }) => t.text)).toEqual(['t3', 't2']);
  });
});

describe('tts', () => {
  it('returns audio for supported languages only', async () => {
    const key = await newKey();
    const ok = await app.inject({
      method: 'POST',
      url: '/api/tts',
      headers: auth(key),
      payload: { text: 'hello', languageCode: 'hi-IN' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('audio/wav');
    const unsupported = await app.inject({
      method: 'POST',
      url: '/api/tts',
      headers: auth(key),
      payload: { text: 'hello', languageCode: 'ur-IN' },
    });
    expect(unsupported.statusCode).toBe(400);
  });
});
