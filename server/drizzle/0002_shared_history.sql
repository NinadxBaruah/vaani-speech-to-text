-- One shared history: every existing transcript stays and becomes visible to everyone.
ALTER TABLE "transcripts" DROP CONSTRAINT IF EXISTS "transcripts_workspace_id_workspaces_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "transcripts_workspace_created_idx";--> statement-breakpoint
ALTER TABLE "transcripts" DROP COLUMN IF EXISTS "workspace_id";--> statement-breakpoint
DROP TABLE IF EXISTS "workspaces";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transcripts_created_idx" ON "transcripts" USING btree ("created_at" DESC NULLS LAST);
