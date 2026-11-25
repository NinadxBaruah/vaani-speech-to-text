import type { FastifyInstance } from 'fastify';

export async function healthRoutes(
  app: FastifyInstance,
  { checkDb }: { checkDb: () => Promise<boolean> },
) {
  app.get('/', { config: { rateLimit: false } }, async (_request, reply) => {
    const db = await checkDb().catch(() => false);
    return reply.status(db ? 200 : 503).send({ ok: db, db });
  });
}
