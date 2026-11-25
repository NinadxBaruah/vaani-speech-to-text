import { UtteranceSegmenter, type SegmenterEvent } from './segmenter.js';
import type { EngineFactory, EngineSession } from './types.js';

/**
 * Self-hosted engine: Oriserve/Whisper-Hindi2Hinglish-Swift served by the `stt-local` sidecar
 * (FastAPI + faster-whisper). Whisper isn't a streaming model, so we segment the live audio
 * into utterances here and ask the sidecar for:
 *   - a quick greedy "partial" roughly every second while someone is speaking, and
 *   - a beam-search "final" once they pause.
 * See docs/PLAN.md section 13.
 */

export const LOCAL_MODEL = 'Oriserve/Whisper-Hindi2Hinglish-Swift';

const PARTIAL_EVERY_BYTES = 32_000; // 1 s of new audio
const MIN_PARTIAL_VOICED_MS = 500;
const MIN_FINAL_VOICED_MS = 400; // shorter blips are usually noise; Whisper hallucinates on them
const FINAL_BEAM = 5;
const REQUEST_TIMEOUT_MS = 20_000;
const HEALTH_TIMEOUT_MS = 3_000;
const STOP_TIMEOUT_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export interface LocalSttClient {
  health(): Promise<boolean>;
  transcribe(pcm: Buffer, options: { beam: number; signal?: AbortSignal }): Promise<string>;
}

export function createLocalSttClient(baseUrl: string): LocalSttClient {
  const root = baseUrl.replace(/\/+$/, '');
  return {
    async health() {
      try {
        const res = await fetch(`${root}/health`, {
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    async transcribe(pcm, { beam, signal }) {
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const res = await fetch(`${root}/transcribe?beam=${beam}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) throw new Error(`stt-local responded ${res.status}`);
      const body = (await res.json()) as { text?: unknown };
      return typeof body.text === 'string' ? body.text.trim() : '';
    },
  };
}

/** Caches the sidecar's health for /api/meta so the UI can grey out the engine when it's down. */
export function cachedHealth(client: LocalSttClient, ttlMs = 30_000) {
  let value: { ok: boolean; at: number } | null = null;
  let inflight: Promise<boolean> | null = null;
  return async (): Promise<boolean> => {
    if (value && Date.now() - value.at < ttlMs) return value.ok;
    inflight ??= client.health().then((ok) => {
      value = { ok, at: Date.now() };
      inflight = null;
      return ok;
    });
    return inflight;
  };
}

export function createLocalWhisperEngine(client: LocalSttClient): EngineFactory {
  return (_options, cb, log): EngineSession => {
    const segmenter = new UtteranceSegmenter();
    const controller = new AbortController();
    let closed = false;
    let stopping = false;
    let totalBytes = 0;
    let utteranceId = 0;
    let finalizedId = 0;
    let partialInFlight = false;
    let lastPartialBytes = 0;
    let failures = 0;
    let finals: Promise<void> = Promise.resolve();

    void client.health().then((ok) => {
      if (closed) return;
      if (ok) cb.onReady();
      else fail('The self-hosted speech engine is not reachable right now');
    });

    function fail(message: string) {
      if (closed) return;
      closed = true;
      controller.abort();
      cb.onFatal(message);
    }

    function onFailure(err: unknown, what: string) {
      if (closed || controller.signal.aborted) return;
      failures++;
      log.warn({ err: err instanceof Error ? err.message : err }, `stt-local ${what} failed`);
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        fail('The self-hosted speech engine keeps failing, please try again later');
      } else if (what === 'final') {
        cb.onEvent({ type: 'error', message: 'Could not transcribe one segment', fatal: false });
      }
    }

    function maybePartial() {
      const audio = segmenter.currentAudio();
      if (!audio || partialInFlight || closed) return;
      if (audio.length - lastPartialBytes < PARTIAL_EVERY_BYTES) return;
      if (segmenter.currentVoicedMs() < MIN_PARTIAL_VOICED_MS) return;

      const id = utteranceId;
      lastPartialBytes = audio.length;
      partialInFlight = true;
      client
        .transcribe(audio, { beam: 1, signal: controller.signal })
        .then((text) => {
          failures = 0;
          // Drop it if the final for this utterance has already been queued.
          if (!closed && text && id === utteranceId && finalizedId < id) {
            cb.onEvent({ type: 'partial', text });
          }
        })
        .catch((err) => onFailure(err, 'partial'))
        .finally(() => {
          partialInFlight = false;
        });
    }

    function handle(events: SegmenterEvent[]) {
      for (const event of events) {
        if (event.type === 'start') {
          utteranceId++;
          lastPartialBytes = 0;
          cb.onEvent({ type: 'speech_start' });
          continue;
        }
        const id = utteranceId;
        finalizedId = id;
        cb.onEvent({ type: 'speech_end' });
        if (event.voicedMs < MIN_FINAL_VOICED_MS) continue;
        // Finals run one after another so they reach the browser in speaking order.
        finals = finals.then(async () => {
          if (closed) return;
          try {
            const text = await client.transcribe(event.audio, {
              beam: FINAL_BEAM,
              signal: controller.signal,
            });
            failures = 0;
            if (!closed) cb.onEvent({ type: 'final', text });
          } catch (err) {
            onFailure(err, 'final');
          }
        });
      }
    }

    return {
      pushAudio(chunk) {
        if (closed || stopping) return;
        totalBytes += chunk.length;
        handle(segmenter.push(chunk));
        maybePartial();
      },
      stop() {
        if (closed || stopping) return;
        stopping = true;
        handle(segmenter.flush());
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS));
        void Promise.race([finals, timeout]).then(() => {
          if (closed) return;
          closed = true;
          controller.abort();
          cb.onEnded(Math.round((totalBytes / 32_000) * 100) / 100);
        });
      },
      close() {
        closed = true;
        controller.abort();
      },
    };
  };
}
