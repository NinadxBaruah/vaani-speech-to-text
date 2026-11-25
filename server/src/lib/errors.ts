import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const unauthorized = (message = 'A valid workspace key is required') =>
  new HttpError(401, 'unauthorized', message);
export const badGateway = (message: string) => new HttpError(502, 'upstream_error', message);

export function errorHandler(
  err: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (err instanceof HttpError) {
    return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    const message = err.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    return reply.status(400).send({ error: { code: 'validation_error', message } });
  }
  const statusCode =
    'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
  if (statusCode >= 500) {
    request.log.error({ err }, 'Unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'internal_error', message: 'Something went wrong' } });
  }
  // Fastify's own 4xx errors (rate limit, bad JSON, payload too large…)
  const code = statusCode === 429 ? 'rate_limited' : 'bad_request';
  return reply.status(statusCode).send({ error: { code, message: err.message } });
}
