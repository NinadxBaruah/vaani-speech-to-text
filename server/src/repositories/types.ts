/** Repository contracts. Routes depend on these, so tests can swap in in-memory fakes. */

export interface Workspace {
  id: string;
  keyPrefix: string;
  createdAt: Date;
}

export interface Transcript {
  id: string;
  title: string;
  text: string;
  languageCode: string | null;
  detectedLanguages: string[];
  engine: string;
  mode: string;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTranscriptInput {
  title: string;
  text: string;
  languageCode: string | null;
  detectedLanguages: string[];
  engine: string;
  mode: string;
  durationMs: number | null;
}

export interface UpdateTranscriptInput {
  title?: string;
  text?: string;
}

export interface ListTranscriptsInput {
  q?: string;
  limit: number;
  offset: number;
}

export interface WorkspaceRepository {
  create(keyHash: string, keyPrefix: string): Promise<Workspace>;
  /** Finds the workspace for a key hash and bumps its last-used time. */
  findByKeyHash(keyHash: string): Promise<Workspace | null>;
}

export interface TranscriptRepository {
  list(
    workspaceId: string,
    input: ListTranscriptsInput,
  ): Promise<{ items: Transcript[]; total: number }>;
  get(workspaceId: string, id: string): Promise<Transcript | null>;
  create(workspaceId: string, input: CreateTranscriptInput): Promise<Transcript>;
  update(workspaceId: string, id: string, input: UpdateTranscriptInput): Promise<Transcript | null>;
  delete(workspaceId: string, id: string): Promise<boolean>;
  count(workspaceId: string): Promise<number>;
}

export interface Repositories {
  workspaces: WorkspaceRepository;
  transcripts: TranscriptRepository;
}
