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

const create = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/transcripts', payload });

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

  it('no longer has per-browser workspaces', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/workspaces' })).statusCode).toBe(404);
  });
});

describe('transcripts CRUD (one shared history)', () => {
  it('creates, reads, lists, searches, updates and deletes without any key', async () => {
    const created = await create({
      text: 'नमस्ते, kal ki meeting 10 baje hai',
      languageCode: 'auto',
      detectedLanguages: ['hi-IN', 'en-IN', 'hi-IN'],
      mode: 'codemix',
      durationMs: 3000,
    });
    expect(created.statusCode).toBe(201);
    const t = created.json();
    expect(t.title).toBe('नमस्ते, kal ki meeting 10 baje hai');
    expect(t.detectedLanguages).toEqual(['hi-IN', 'en-IN']);
    expect(t.engine).toBe('sarvam');

    const got = await app.inject(`/api/transcripts/${t.id}`);
    expect(got.json().text).toBe('नमस्ते, kal ki meeting 10 baje hai');

    expect((await app.inject('/api/transcripts?q=MEETING')).json().total).toBe(1);
    expect((await app.inject('/api/transcripts?q=zebra')).json().total).toBe(0);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/transcripts/${t.id}`,
      payload: { title: 'Meeting', text: 'Updated text' },
    });
    expect(patched.json()).toMatchObject({ title: 'Meeting', text: 'Updated text' });

    const del = await app.inject({ method: 'DELETE', url: `/api/transcripts/${t.id}` });
    expect(del.statusCode).toBe(204);
    const again = await app.inject({ method: 'DELETE', url: `/api/transcripts/${t.id}` });
    expect(again.statusCode).toBe(404);
  });

  it('stores which engine produced the transcript', async () => {
    const t = (await create({ text: 'kal ki meeting das baje hai', engine: 'local' })).json();
    expect(t.engine).toBe('local');
    expect((await create({ text: 'x', engine: 'gpt' })).statusCode).toBe(400);
  });

  it('validates input', async () => {
    const cases = [
      { text: '' },
      { text: 'ok', languageCode: 'xx-XX' },
      { text: 'ok', mode: 'shout' },
      { text: 'x'.repeat(20_001) },
    ];
    for (const payload of cases) {
      const res = await create(payload);
      expect(res.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
      expect(res.json().error.code).toBe('validation_error');
    }
    expect((await app.inject('/api/transcripts/not-a-uuid')).statusCode).toBe(400);
    const emptyPatch = await app.inject({
      method: 'PATCH',
      url: '/api/transcripts/7baab6e6-dd90-4619-b23b-c0be97ec860a',
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);
  });

  it('paginates newest first', async () => {
    for (let i = 0; i < 5; i++) {
      await create({ text: `t${i}` });
      await new Promise((r) => setTimeout(r, 2));
    }
    const page = (await app.inject('/api/transcripts?limit=2&offset=1')).json();
    expect(page.total).toBe(5);
    expect(page.items.map((t: { text: string }) => t.text)).toEqual(['t3', 't2']);
  });
});

describe('tts', () => {
  it('returns audio for supported languages only', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/tts',
      payload: { text: 'hello', languageCode: 'hi-IN' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('audio/wav');
    const unsupported = await app.inject({
      method: 'POST',
      url: '/api/tts',
      payload: { text: 'hello', languageCode: 'ur-IN' },
    });
    expect(unsupported.statusCode).toBe(400);
  });
});
