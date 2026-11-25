import type { FastifyBaseLogger } from 'fastify';
import type { ClientEvent } from '../sarvamRealtime.js';

/**
 * A speech-to-text engine behind the /api/transcribe WebSocket.
 * The route owns the browser protocol (auth, limits, close codes); an engine only turns
 * PCM16 16 kHz audio into ClientEvents. See docs/PLAN.md sections 8 and 13.
 */

export const ENGINE_IDS = ['sarvam', 'local'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export type EngineEvent = Exclude<ClientEvent, { type: 'session_end' }>;

export interface EngineCallbacks {
  /** The engine can take audio (audio pushed earlier is buffered by the engine). */
  onReady(): void;
  /** partial / final / speech_start / speech_end / non-fatal error. */
  onEvent(event: EngineEvent): void;
  /** Graceful stop finished: every final has been delivered. */
  onEnded(audioDurationS?: number): void;
  /** Unrecoverable failure; the route closes the browser socket. */
  onFatal(message: string): void;
}

export interface EngineSession {
  pushAudio(chunk: Buffer): void;
  /** Finalise buffered audio, then call onEnded. */
  stop(): void;
  /** Hard close (browser went away). No callbacks after this. */
  close(): void;
}

export interface EngineOptions {
  languageCode: string;
  mode: string;
}

export type EngineFactory = (
  options: EngineOptions,
  callbacks: EngineCallbacks,
  log: FastifyBaseLogger,
) => EngineSession;

export interface EngineInfo {
  id: EngineId;
  label: string;
  kind: 'third-party' | 'self-hosted';
  model: string;
  available: boolean;
  summary: string;
}
