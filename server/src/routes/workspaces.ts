import type { FastifyInstance } from 'fastify';
import { generateWorkspaceKey, hashWorkspaceKey, keyDisplayPrefix } from '../lib/apiKey.js';
import { currentWorkspace, requireWorkspace } from '../plugins/auth.js';
import type { Repositories } from '../repositories/types.js';

export async function workspaceRoutes(app: FastifyInstance, { repos }: { repos: Repositories }) {
  // Creates a workspace and returns its key exactly once. Rate-limited per IP.
  app.post(
    '/',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (_request, reply) => {
      const key = generateWorkspaceKey();
      const workspace = await repos.workspaces.create(hashWorkspaceKey(key), keyDisplayPrefix(key));
      return reply.status(201).send({ key, workspace });
    },
  );

  app.get('/me', { preHandler: requireWorkspace(repos.workspaces) }, async (request) => {
    const workspace = currentWorkspace(request);
    const transcriptCount = await repos.transcripts.count(workspace.id);
    return { ...workspace, transcriptCount };
  });
}
