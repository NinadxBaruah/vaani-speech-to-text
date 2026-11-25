import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import type { Repositories, Transcript } from '../src/repositories/types.js';
import { createEngines } from '../src/services/engines/index.js';

/** In-memory repository that mirrors the Postgres behaviour the routes rely on. */
export function createFakeRepos(): Repositories {
  const rows = new Map<string, Transcript>();

  return {
    transcripts: {
      async list({ q, limit, offset }) {
        const needle = q?.toLowerCase();
        const all = [...rows.values()]
          .filter((t) => !needle || `${t.title} ${t.text}`.toLowerCase().includes(needle))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return { items: all.slice(offset, offset + limit), total: all.length };
      },
      async get(id) {
        return rows.get(id) ?? null;
      },
      async create(input) {
        const now = new Date();
        const t = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
        rows.set(t.id, t);
        return t;
      },
      async update(id, input) {
        const t = rows.get(id);
        if (!t) return null;
        Object.assign(t, input, { updatedAt: new Date() });
        return t;
      },
      async delete(id) {
        return rows.delete(id);
      },
    },
  };
}

export async function buildTestApp(overrides: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return buildApp({
    repos: createFakeRepos(),
    tts: async () => Buffer.from('RIFF-fake-wav'),
    checkDb: async () => true,
    engines: createEngines({ sarvamApiKey: 'test-key-not-real' }),
    maxSessionSeconds: 60,
    ...overrides,
  });
}
