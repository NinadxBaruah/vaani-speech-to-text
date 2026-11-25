/** Repository contracts. Routes depend on these, so tests can swap in in-memory fakes. */

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

export interface TranscriptRepository {
  list(input: ListTranscriptsInput): Promise<{ items: Transcript[]; total: number }>;
  get(id: string): Promise<Transcript | null>;
  create(input: CreateTranscriptInput): Promise<Transcript>;
  update(id: string, input: UpdateTranscriptInput): Promise<Transcript | null>;
  delete(id: string): Promise<boolean>;
}

export interface Repositories {
  transcripts: TranscriptRepository;
}
