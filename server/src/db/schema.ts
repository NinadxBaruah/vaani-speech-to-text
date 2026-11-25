import { sql } from 'drizzle-orm';
import { char, index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  // SHA-256 hex of the workspace key. The key itself is never stored.
  keyHash: char('key_hash', { length: 64 }).notNull().unique(),
  // First characters of the key, safe to show in the UI to identify it.
  keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
});

export const transcripts = pgTable(
  'transcripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
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
  (t) => [index('transcripts_workspace_created_idx').on(t.workspaceId, t.createdAt.desc())],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type TranscriptRow = typeof transcripts.$inferSelect;
export type NewTranscriptRow = typeof transcripts.$inferInsert;
