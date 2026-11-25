import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { STT_LANGUAGE_CODES, STT_MODE_IDS } from '../lib/languages.js';
import { notFound } from '../lib/errors.js';
import { ENGINE_IDS } from '../services/engines/types.js';
import { currentWorkspace, requireWorkspace } from '../plugins/auth.js';
import type { Repositories } from '../repositories/types.js';

const MAX_TEXT = 20_000;
const MAX_TITLE = 200;

const IdParams = z.object({ id: z.uuid() });

const ListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const languageCode = z.enum(STT_LANGUAGE_CODES);
const knownLanguage = z.string().regex(/^[a-z]{2,3}-[A-Z]{2}$/);

const CreateBody = z.object({
  title: z.string().trim().max(MAX_TITLE).optional(),
  text: z.string().trim().min(1).max(MAX_TEXT),
  languageCode: languageCode.nullish(),
  detectedLanguages: z.array(knownLanguage).max(30).default([]),
  engine: z.enum(ENGINE_IDS).default('sarvam'),
  mode: z.enum(STT_MODE_IDS).default('transcribe'),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600 * 1000)
    .nullish(),
});

const UpdateBody = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE).optional(),
    text: z.string().trim().min(1).max(MAX_TEXT).optional(),
  })
  .refine((b) => b.title !== undefined || b.text !== undefined, {
    message: 'Provide a title or text to update',
  });

/** "Namaste, aaj ka meeting kab hai…" → first ~8 words, trimmed to the column size. */
export function titleFromText(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const title = words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '');
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;
}

export async function transcriptRoutes(app: FastifyInstance, { repos }: { repos: Repositories }) {
  app.addHook('preHandler', requireWorkspace(repos.workspaces));

  app.get('/', async (request) => {
    const query = ListQuery.parse(request.query);
    return repos.transcripts.list(currentWorkspace(request).id, query);
  });

  app.get('/:id', async (request) => {
    const { id } = IdParams.parse(request.params);
    const transcript = await repos.transcripts.get(currentWorkspace(request).id, id);
    if (!transcript) throw notFound('Transcript');
    return transcript;
  });

  app.post('/', async (request, reply) => {
    const body = CreateBody.parse(request.body);
    const transcript = await repos.transcripts.create(currentWorkspace(request).id, {
      title: body.title || titleFromText(body.text),
      text: body.text,
      languageCode: body.languageCode ?? null,
      detectedLanguages: [...new Set(body.detectedLanguages)],
      engine: body.engine,
      mode: body.mode,
      durationMs: body.durationMs ?? null,
    });
    return reply.status(201).send(transcript);
  });

  app.patch('/:id', async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = UpdateBody.parse(request.body);
    const transcript = await repos.transcripts.update(currentWorkspace(request).id, id, body);
    if (!transcript) throw notFound('Transcript');
    return transcript;
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const deleted = await repos.transcripts.delete(currentWorkspace(request).id, id);
    if (!deleted) throw notFound('Transcript');
    return reply.status(204).send();
  });
}
