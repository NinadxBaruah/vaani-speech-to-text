/** Typed client for the server API (contract: docs/PLAN.md section 7). */

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export type EngineId = 'sarvam' | 'local';

export interface EngineInfo {
  id: EngineId;
  label: string;
  kind: 'third-party' | 'self-hosted';
  model: string;
  available: boolean;
  summary: string;
}

export interface Meta {
  sttModel: string;
  autoLanguage: string;
  engines: EngineInfo[];
  sttLanguages: Language[];
  ttsLanguages: Language[];
  modes: { id: string; label: string; hint: string }[];
  ttsSpeakers: { id: string; label: string }[];
}

export interface Transcript {
  id: string;
  title: string;
  text: string;
  languageCode: string | null;
  detectedLanguages: string[];
  engine: EngineId;
  mode: string;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptPage {
  items: Transcript[];
  total: number;
}

export interface WorkspaceInfo {
  id: string;
  keyPrefix: string;
  createdAt: string;
  transcriptCount: number;
}

export interface NewTranscript {
  title?: string;
  text: string;
  languageCode?: string | null;
  detectedLanguages?: string[];
  engine?: EngineId;
  mode?: string;
  durationMs?: number | null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  key?: string | null;
  signal?: AbortSignal;
}

async function request(path: string, { method = 'GET', body, key, signal }: RequestOptions = {}) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers.authorization = `Bearer ${key}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection.');
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'http_error',
      data?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return res;
}

async function json<T>(path: string, options?: RequestOptions): Promise<T> {
  return (await request(path, options)).json() as Promise<T>;
}

export const api = {
  meta: () => json<Meta>('/meta'),

  createWorkspace: () =>
    json<{ key: string; workspace: Omit<WorkspaceInfo, 'transcriptCount'> }>('/workspaces', {
      method: 'POST',
    }),
  me: (key: string) => json<WorkspaceInfo>('/workspaces/me', { key }),

  listTranscripts: (key: string, params: { q?: string; limit: number; offset: number }) => {
    const qs = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    if (params.q) qs.set('q', params.q);
    return json<TranscriptPage>(`/transcripts?${qs}`, { key });
  },
  createTranscript: (key: string, body: NewTranscript) =>
    json<Transcript>('/transcripts', { method: 'POST', key, body }),
  updateTranscript: (key: string, id: string, body: { title?: string; text?: string }) =>
    json<Transcript>(`/transcripts/${id}`, { method: 'PATCH', key, body }),
  deleteTranscript: async (key: string, id: string) => {
    await request(`/transcripts/${id}`, { method: 'DELETE', key });
  },

  speak: async (key: string, body: { text: string; languageCode: string; speaker?: string }) =>
    (await request('/tts', { method: 'POST', key, body })).blob(),
};
