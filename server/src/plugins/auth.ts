import type { FastifyRequest } from 'fastify';
import { hashWorkspaceKey, isWellFormedKey, parseBearer } from '../lib/apiKey.js';
import { unauthorized } from '../lib/errors.js';
import type { Workspace, WorkspaceRepository } from '../repositories/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    workspace?: Workspace;
  }
}

/** Looks up the workspace for a raw key. Returns null for malformed or unknown keys. */
export async function resolveWorkspace(
  repo: WorkspaceRepository,
  key: string | null | undefined,
): Promise<Workspace | null> {
  if (!key || !isWellFormedKey(key)) return null;
  return repo.findByKeyHash(hashWorkspaceKey(key));
}

/** preHandler: requires `Authorization: Bearer <workspace key>` and sets request.workspace. */
export function requireWorkspace(repo: WorkspaceRepository) {
  return async (request: FastifyRequest) => {
    const workspace = await resolveWorkspace(repo, parseBearer(request.headers.authorization));
    if (!workspace) throw unauthorized();
    request.workspace = workspace;
  };
}

/** Narrowing helper for handlers that run after requireWorkspace. */
export function currentWorkspace(request: FastifyRequest): Workspace {
  if (!request.workspace) throw unauthorized();
  return request.workspace;
}
