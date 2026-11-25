import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { workspaces } from '../db/schema.js';
import type { Workspace, WorkspaceRepository } from './types.js';

const columns = {
  id: workspaces.id,
  keyPrefix: workspaces.keyPrefix,
  createdAt: workspaces.createdAt,
};

export function createWorkspaceRepository(db: Database): WorkspaceRepository {
  return {
    async create(keyHash, keyPrefix): Promise<Workspace> {
      const [row] = await db.insert(workspaces).values({ keyHash, keyPrefix }).returning(columns);
      if (!row) throw new Error('Insert returned no row');
      return row;
    },

    async findByKeyHash(keyHash) {
      // One round trip: update last_used_at and return the row (null if no match).
      // Only bump when older than a minute to avoid a write on every request.
      const [row] = await db
        .update(workspaces)
        .set({
          lastUsedAt: sql`case when ${workspaces.lastUsedAt} < now() - interval '1 minute' then now() else ${workspaces.lastUsedAt} end`,
        })
        .where(eq(workspaces.keyHash, keyHash))
        .returning(columns);
      return row ?? null;
    },
  };
}
