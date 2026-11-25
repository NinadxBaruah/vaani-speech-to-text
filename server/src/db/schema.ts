import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/** One shared transcript history: everybody using the site sees the same rows (docs/PLAN.md §5). */
export const transcripts = pgTable(
  'transcripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 200 }).notNull(),
    text: text('text').notNull(),
    languageCode: varchar('language_code', { length: 16 }),
    detectedLanguages: text('detected_languages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    engine: varchar('engine', { length: 16 }).notNull().default('sarvam'),
    mode: varchar('mode', { length: 16 }).notNull().default('transcribe'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('transcripts_created_idx').on(t.createdAt.desc())],
);

export type TranscriptRow = typeof transcripts.$inferSelect;
export type NewTranscriptRow = typeof transcripts.$inferInsert;
