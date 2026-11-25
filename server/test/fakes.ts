import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { createEngines } from '../src/services/engines/index.js';
import type { Repositories, Transcript, Workspace } from '../src/repositories/types.js';

/** In-memory repositories that mirror the Postgres behaviour the routes rely on. */
export function createFakeRepos(): Repositories {
  const workspaces = new Map<string, Workspace & { keyHash: string }>();
  const transcripts = new Map<string, Transcript & { workspaceId: string }>();
  const strip = ({ workspaceId: _w, ...t }: Transcript & { workspaceId: string }): Transcript => t;

  return {
    workspaces: {
      async create(keyHash, keyPrefix) {
        const ws = { id: randomUUID(), keyHash, keyPrefix, createdAt: new Date() };
        workspaces.set(ws.id, ws);
        return { id: ws.id, keyPrefix, createdAt: ws.createdAt };
      },
      async findByKeyHash(keyHash) {
        const ws = [...workspaces.values()].find((w) => w.keyHash === keyHash);
        return ws ? { id: ws.id, keyPrefix: ws.keyPrefix, createdAt: ws.createdAt } : null;
      },
    },
    transcripts: {
      async list(workspaceId, { q, limit, offset }) {
        const needle = q?.toLowerCase();
        const all = [...transcripts.values()]
          .filter((t) => t.workspaceId === workspaceId)
          .filter((t) => !needle || `${t.title} ${t.text}`.toLowerCase().includes(needle))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return { items: all.slice(offset, offset + limit).map(strip), total: all.length };
      },
      async get(workspaceId, id) {
        const t = transcripts.get(id);
        return t && t.workspaceId === workspaceId ? strip(t) : null;
      },
      async create(workspaceId, input) {
        const now = new Date();
        const t = { id: randomUUID(), workspaceId, ...input, createdAt: now, updatedAt: now };
        transcripts.set(t.id, t);
        return strip(t);
      },
      async update(workspaceId, id, input) {
        const t = transcripts.get(id);
        if (!t || t.workspaceId !== workspaceId) return null;
        Object.assign(t, input, { updatedAt: new Date() });
        return strip(t);
      },
      async delete(workspaceId, id) {
        const t = transcripts.get(id);
        if (!t || t.workspaceId !== workspaceId) return false;
        return transcripts.delete(id);
      },
      async count(workspaceId) {
        return [...transcripts.values()].filter((t) => t.workspaceId === workspaceId).length;
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
