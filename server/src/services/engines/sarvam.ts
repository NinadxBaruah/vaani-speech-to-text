import WebSocket from 'ws';
import {
  SARVAM_REALTIME_URL,
  buildRealtimeUrl,
  describeUpstreamClose,
  normalizeSarvamEvent,
} from '../sarvamRealtime.js';
import type { EngineFactory, EngineSession } from './types.js';

const STOP_GRACE_MS = 8_000;
const MAX_PENDING_BYTES = 16_000 * 2 * 5; // 5 s of 16 kHz PCM16 while the upstream connects

/** Third-party engine: proxies audio to Sarvam's realtime WebSocket (saaras:v4). */
export function createSarvamEngine({
  apiKey,
  realtimeUrl = SARVAM_REALTIME_URL,
}: {
  apiKey: string;
  realtimeUrl?: string;
}): EngineFactory {
  return ({ languageCode, mode }, cb, log): EngineSession => {
    let state: 'connecting' | 'live' | 'stopping' | 'closed' = 'connecting';
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let endSent = false;
    let stopTimer: NodeJS.Timeout | undefined;

    const upstream = new WebSocket(buildRealtimeUrl({ languageCode, mode }, realtimeUrl), {
      headers: { 'api-subscription-key': apiKey },
      handshakeTimeout: 10_000,
    });

    const send = (payload: object) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(payload));
    };
    const forward = (chunk: Buffer) =>
      send({ event: 'audio_input', audio: chunk.toString('base64') });

    const ended = (audioDurationS?: number) => {
      if (state === 'closed') return;
      state = 'closed';
      clearTimeout(stopTimer);
      cb.onEnded(audioDurationS);
      shutdown();
    };
    const fatal = (message: string) => {
      if (state === 'closed') return;
      state = 'closed';
      clearTimeout(stopTimer);
      cb.onFatal(message);
      shutdown();
    };
    const shutdown = () => {
      if (upstream.readyState === WebSocket.OPEN) {
        if (!endSent) upstream.send(JSON.stringify({ event: 'end' }));
        upstream.close(1000);
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        upstream.terminate();
      }
    };

    upstream.on('open', () => {
      if (state === 'closed') return;
      for (const chunk of pending) forward(chunk);
      pending = [];
      pendingBytes = 0;
      if (state === 'connecting') state = 'live';
      cb.onReady();
      if (state === 'stopping') beginStop();
    });

    upstream.on('message', (data) => {
      if (state === 'closed') return;
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return;
      }
      const event = normalizeSarvamEvent(raw);
      if (!event) return;
      if (event.type === 'session_end') return ended(event.audioDurationS);
      if (event.type === 'error') {
        log.warn({ upstreamError: event.message }, 'sarvam error');
        if (event.fatal) return fatal(event.message);
      }
      cb.onEvent(event);
    });

    upstream.on('unexpected-response', (_req, res) => {
      log.warn({ status: res.statusCode }, 'sarvam rejected websocket upgrade');
      fatal(`Speech service rejected the connection (${res.statusCode})`);
    });
    upstream.on('error', (err) => {
      log.warn({ err: err.message }, 'sarvam socket error');
      fatal('Speech service connection failed');
    });
    upstream.on('close', (code) => {
      if (state === 'stopping') return ended();
      fatal(describeUpstreamClose(code));
    });

    function beginStop() {
      send({ event: 'flush' });
      send({ event: 'end' });
      endSent = true;
      stopTimer = setTimeout(() => ended(), STOP_GRACE_MS);
    }

    return {
      pushAudio(chunk) {
        if (state === 'live') forward(chunk);
        else if (state === 'connecting' && pendingBytes + chunk.length <= MAX_PENDING_BYTES) {
          pending.push(chunk);
          pendingBytes += chunk.length;
        }
      },
      stop() {
        if (state === 'live') {
          state = 'stopping';
          beginStop();
        } else if (state === 'connecting') {
          state = 'stopping'; // finish once the socket opens and buffered audio is sent
        }
      },
      close() {
        if (state === 'closed') return;
        state = 'closed';
        clearTimeout(stopTimer);
        pending = [];
        shutdown();
      },
    };
  };
}
