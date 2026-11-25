import { count, desc, eq, ilike, or, sql } from 'drizzle-orm';
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
  return {
    async list({ q, limit, offset }) {
      const pattern = q ? likePattern(q) : null;
      const where = pattern
        ? or(ilike(transcripts.title, pattern), ilike(transcripts.text, pattern))
        : undefined;

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

    async get(id) {
      const [row] = await db.select(columns).from(transcripts).where(eq(transcripts.id, id));
      return row ?? null;
    },

    async create(input): Promise<Transcript> {
      const [row] = await db.insert(transcripts).values(input).returning(columns);
      if (!row) throw new Error('Insert returned no row');
      return row;
    },

    async update(id, input) {
      const [row] = await db
        .update(transcripts)
        .set({ ...input, updatedAt: sql`now()` })
        .where(eq(transcripts.id, id))
        .returning(columns);
      return row ?? null;
    },

    async delete(id) {
      const rows = await db
        .delete(transcripts)
        .where(eq(transcripts.id, id))
        .returning({ id: transcripts.id });
      return rows.length > 0;
    },
  };
}
