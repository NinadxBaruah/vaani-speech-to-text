import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import WebSocket, { type RawData } from 'ws';
import { z } from 'zod';
import { STT_LANGUAGE_CODES, STT_MODE_IDS } from '../lib/languages.js';
import { resolveWorkspace } from '../plugins/auth.js';
import type { Repositories } from '../repositories/types.js';
import {
  ENGINE_IDS,
  type EngineEvent,
  type EngineFactory,
  type EngineId,
  type EngineSession,
} from '../services/engines/types.js';

/**
 * Live transcription WebSocket: browser ⇄ this server ⇄ the chosen engine
 * (Sarvam saaras:v4, or the self-hosted Whisper sidecar).
 * Protocol: docs/PLAN.md section 8; engines: section 13.
 */

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 40_000; // safety net; engines normally finish much sooner
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_EARLY_BYTES = 16_000 * 2 * 5; // audio sent while the key is being checked (≤ 5 s)

/** App-specific close codes (4000-4999 are free for applications). */
export const CloseCode = {
  normal: 1000,
  badMessage: 4400,
  unauthorized: 4401,
  startTimeout: 4408,
  upstream: 4502,
  unavailable: 4503,
} as const;

const ClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    key: z.string().max(100),
    engine: z.enum(ENGINE_IDS).default('sarvam'),
    languageCode: z.enum(STT_LANGUAGE_CODES).default('auto'),
    mode: z.enum(STT_MODE_IDS).default('transcribe'),
  }),
  z.object({ type: z.literal('stop') }),
]);

type OutgoingEvent =
  EngineEvent | { type: 'ready'; engine: EngineId } | { type: 'ended'; audioDurationS?: number };

export interface TranscribeDeps {
  repos: Repositories;
  engines: Partial<Record<EngineId, EngineFactory>>;
  maxSessionSeconds: number;
}

export async function transcribeRoutes(app: FastifyInstance, deps: TranscribeDeps) {
  app.get(
    '/',
    { websocket: true, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    (socket, request) => {
      new TranscribeSession(socket, deps, request.log).run();
    },
  );
}

type State = 'awaiting_start' | 'authenticating' | 'live' | 'stopping' | 'closed';

class TranscribeSession {
  private state: State = 'awaiting_start';
  private engine: EngineSession | null = null;
  private timers: NodeJS.Timeout[] = [];
  private early: Buffer[] = [];
  private earlyBytes = 0;

  constructor(
    private readonly client: WebSocket,
    private readonly deps: TranscribeDeps,
    private readonly log: FastifyBaseLogger,
  ) {}

  run() {
    this.timers.push(
      setTimeout(() => {
        if (this.state === 'awaiting_start' || this.state === 'authenticating') {
          this.fail(CloseCode.startTimeout, 'No start message received in time');
        }
      }, START_TIMEOUT_MS),
    );

    this.client.on('message', (data, isBinary) => {
      if (isBinary) this.onAudio(data);
      else void this.onControl(data);
    });
    this.client.on('close', () => this.cleanup());
    this.client.on('error', (err) => {
      this.log.warn({ err }, 'client socket error');
      this.cleanup();
    });
  }

  private send(event: OutgoingEvent) {
    if (this.client.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(event));
  }

  /** Sends a fatal error and closes the socket. */
  private fail(code: number, message: string) {
    this.send({ type: 'error', message, fatal: true });
    this.closeClient(code, message);
  }

  private closeClient(code: number, reason: string) {
    if (
      this.client.readyState === WebSocket.OPEN ||
      this.client.readyState === WebSocket.CONNECTING
    ) {
      // Close reasons are limited to 123 bytes.
      this.client.close(code, reason.slice(0, 120));
    }
    this.cleanup();
  }

  private async onControl(data: RawData) {
    let parsed: z.infer<typeof ClientMessage>;
    try {
      parsed = ClientMessage.parse(JSON.parse(rawToBuffer(data).toString('utf8')));
    } catch {
      return this.fail(CloseCode.badMessage, 'Invalid message');
    }

    if (parsed.type === 'stop') return this.stop();

    if (this.state !== 'awaiting_start') {
      return this.fail(CloseCode.badMessage, 'Session already started');
    }
    this.state = 'authenticating';

    const workspace = await resolveWorkspace(this.deps.repos.workspaces, parsed.key).catch(
      (err) => {
        this.log.error({ err }, 'workspace lookup failed');
        return null;
      },
    );
    if (this.state !== 'authenticating') return; // client left meanwhile
    if (!workspace) return this.fail(CloseCode.unauthorized, 'Invalid workspace key');

    const factory = this.deps.engines[parsed.engine];
    if (!factory) {
      return this.fail(CloseCode.unavailable, 'That speech engine is not enabled on this server');
    }

    this.log.info(
      {
        workspaceId: workspace.id,
        engine: parsed.engine,
        languageCode: parsed.languageCode,
        mode: parsed.mode,
      },
      'transcription session starting',
    );
    this.state = 'live';
    const engineId = parsed.engine;
    this.engine = factory(
      { languageCode: parsed.languageCode, mode: parsed.mode },
      {
        onReady: () => {
          if (this.state === 'closed') return;
          this.send({ type: 'ready', engine: engineId });
          this.timers.push(
            setTimeout(() => {
              this.send({ type: 'error', message: 'Maximum session length reached', fatal: false });
              this.stop();
            }, this.deps.maxSessionSeconds * 1000),
          );
        },
        onEvent: (event) => {
          if (this.state !== 'closed') this.send(event);
        },
        onEnded: (audioDurationS) => this.finish(audioDurationS),
        onFatal: (message) => {
          if (this.state !== 'closed') this.fail(CloseCode.upstream, message);
        },
      },
      this.log,
    );
    for (const chunk of this.early) this.engine.pushAudio(chunk);
    this.early = [];
    this.earlyBytes = 0;
  }

  private onAudio(data: RawData) {
    if (this.state !== 'live' && this.state !== 'authenticating') return;
    const chunk = rawToBuffer(data);
    if (chunk.length === 0 || chunk.length > MAX_FRAME_BYTES || chunk.length % 2 !== 0) {
      return this.fail(CloseCode.badMessage, 'Audio frames must be PCM16 and at most 64 KB');
    }
    if (this.engine) {
      this.engine.pushAudio(chunk);
    } else if (this.earlyBytes + chunk.length <= MAX_EARLY_BYTES) {
      // Still checking the key: hold the audio so the first words aren't lost.
      this.early.push(chunk);
      this.earlyBytes += chunk.length;
    }
  }

  /** Graceful stop: the engine finalises buffered audio, then calls onEnded. */
  private stop() {
    if (this.state === 'awaiting_start' || this.state === 'authenticating') return this.finish();
    if (this.state !== 'live') return;
    this.state = 'stopping';
    this.timers.push(setTimeout(() => this.finish(), STOP_TIMEOUT_MS));
    this.engine?.stop();
  }

  private finish(audioDurationS?: number) {
    if (this.state === 'closed') return;
    this.send(audioDurationS === undefined ? { type: 'ended' } : { type: 'ended', audioDurationS });
    this.closeClient(CloseCode.normal, 'done');
  }

  private cleanup() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.early = [];
    this.engine?.close();
    this.engine = null;
  }
}

function rawToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
