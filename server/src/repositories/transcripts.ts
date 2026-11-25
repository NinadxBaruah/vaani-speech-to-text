import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { transcripts } from '../db/schema.js';
import type { Transcript, TranscriptRepository } from './types.js';

const columns = {
  id: transcripts.id,
  title: transcripts.title,
  text: transcripts.text,
  languageCode: transcripts.languageCode,
  detectedLanguages: transcripts.detectedLanguages,
  engine: transcripts.engine,
  mode: transcripts.mode,
  durationMs: transcripts.durationMs,
  createdAt: transcripts.createdAt,
  updatedAt: transcripts.updatedAt,
};

/** Escapes LIKE wildcards so user input is matched literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function createTranscriptRepository(db: Database): TranscriptRepository {
  const owned = (workspaceId: string, id: string) =>
    and(eq(transcripts.workspaceId, workspaceId), eq(transcripts.id, id));

  return {
    async list(workspaceId, { q, limit, offset }) {
      const filters = [eq(transcripts.workspaceId, workspaceId)];
      if (q) {
        const pattern = likePattern(q);
        const search = or(ilike(transcripts.title, pattern), ilike(transcripts.text, pattern));
        if (search) filters.push(search);
      }
      const where = and(...filters);

      const [items, totals] = await Promise.all([
        db
          .select(columns)
          .from(transcripts)
          .where(where)
          .orderBy(desc(transcripts.createdAt), desc(transcripts.id))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(transcripts).where(where),
      ]);
      return { items, total: totals[0]?.total ?? 0 };
    },

    async get(workspaceId, id) {
      const [row] = await db.select(columns).from(transcripts).where(owned(workspaceId, id));
      return row ?? null;
    },

    async create(workspaceId, input): Promise<Transcript> {
      const [row] = await db
        .insert(transcripts)
        .values({ workspaceId, ...input })
        .returning(columns);
      if (!row) throw new Error('Insert returned no row');
      return row;
    },

    async update(workspaceId, id, input) {
      const [row] = await db
        .update(transcripts)
        .set({ ...input, updatedAt: sql`now()` })
        .where(owned(workspaceId, id))
        .returning(columns);
      return row ?? null;
    },

    async delete(workspaceId, id) {
      const rows = await db
        .delete(transcripts)
        .where(owned(workspaceId, id))
        .returning({ id: transcripts.id });
      return rows.length > 0;
    },

    async count(workspaceId) {
      const [row] = await db
        .select({ total: count() })
        .from(transcripts)
        .where(eq(transcripts.workspaceId, workspaceId));
      return row?.total ?? 0;
    },
  };
}
