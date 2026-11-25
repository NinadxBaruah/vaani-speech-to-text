import { useCallback, useEffect, useRef, useState } from 'react';
import { MicPermissionError, MicRecorder } from '../lib/recorder';

/**
 * Live transcription session: mic → /api/transcribe WS → partial/final text.
 * Protocol: docs/PLAN.md section 8.
 */

export type TranscriberStatus = 'idle' | 'connecting' | 'live' | 'stopping';

export interface Segment {
  text: string;
  language?: string;
}

export interface FinishedRecording {
  text: string;
  segments: Segment[];
  detectedLanguages: string[];
  durationMs: number;
}

interface ServerEvent {
  type: 'ready' | 'partial' | 'final' | 'speech_start' | 'speech_end' | 'error' | 'ended';
  text?: string;
  language?: string;
  message?: string;
  fatal?: boolean;
}

const STOP_TIMEOUT_MS = 12_000;

function socketUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/transcribe`;
}

export function useTranscriber(onFinished: (recording: FinishedRecording) => void) {
  const [status, setStatus] = useState<TranscriberStatus>('idle');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const startedAtRef = useRef(0);
  const durationRef = useRef(0);
  const segmentsRef = useRef<Segment[]>([]);
  const partialRef = useRef<Segment | null>(null);
  const timersRef = useRef<{ tick?: number; stop?: number }>({});
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const stopRecorder = useCallback(() => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    void rec?.stop();
    window.clearInterval(timersRef.current.tick);
    setLevel(0);
    setSpeaking(false);
  }, []);

  const handleClose = useCallback(
    (event: CloseEvent) => {
      window.clearTimeout(timersRef.current.stop);
      stopRecorder();
      wsRef.current = null;

      // Keep any trailing words that never got a final.
      const leftover = partialRef.current;
      if (leftover?.text.trim()) segmentsRef.current = [...segmentsRef.current, leftover];
      partialRef.current = null;
      setPartial('');
      setSegments(segmentsRef.current);

      if (event.code !== 1000 && event.code !== 1005) {
        setError((prev) => prev ?? (event.reason || 'Connection to the server was lost.'));
      }
      setStatus('idle');

      const finalSegments = segmentsRef.current;
      const text = finalSegments
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join(' ');
      if (text) {
        onFinishedRef.current({
          text,
          segments: finalSegments,
          detectedLanguages: [
            ...new Set(finalSegments.map((s) => s.language).filter((l): l is string => !!l)),
          ],
          durationMs: durationRef.current || performance.now() - startedAtRef.current,
        });
      }
    },
    [stopRecorder],
  );

  const handleEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'ready':
        setStatus((s) => (s === 'connecting' ? 'live' : s));
        break;
      case 'partial':
        partialRef.current = { text: event.text ?? '', language: event.language };
        setPartial(event.text ?? '');
        break;
      case 'final': {
        const text = event.text?.trim();
        partialRef.current = null;
        setPartial('');
        if (text) {
          segmentsRef.current = [...segmentsRef.current, { text, language: event.language }];
          setSegments(segmentsRef.current);
        }
        break;
      }
      case 'speech_start':
        setSpeaking(true);
        break;
      case 'speech_end':
        setSpeaking(false);
        break;
      case 'error':
        setError(event.message ?? 'Transcription error');
        break;
      case 'ended':
        break;
    }
  }, []);

  const start = useCallback(
    async ({
      key,
      engine,
      languageCode,
      mode,
    }: {
      key: string;
      engine: string;
      languageCode: string;
      mode: string;
    }) => {
      if (wsRef.current) return;
      setError(null);
      setSegments([]);
      setPartial('');
      segmentsRef.current = [];
      partialRef.current = null;
      durationRef.current = 0;
      setElapsedMs(0);
      setStatus('connecting');

      const recorder = new MicRecorder();
      recorderRef.current = recorder;
      try {
        // Ask for the mic first so a denied permission never opens a paid upstream session.
        await recorder.start({
          onFrame: (pcm) => {
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) ws.send(pcm);
          },
          onLevel: setLevel,
        });
      } catch (err) {
        recorderRef.current = null;
        void recorder.stop();
        setStatus('idle');
        setError(
          err instanceof MicPermissionError ? err.message : 'Could not start the microphone.',
        );
        return;
      }
      if (recorderRef.current !== recorder) {
        void recorder.stop(); // cancelled while waiting for permission
        return;
      }

      const ws = new WebSocket(socketUrl());
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'start', key, engine, languageCode, mode }));
      ws.onmessage = (e: MessageEvent<string>) => {
        try {
          handleEvent(JSON.parse(e.data) as ServerEvent);
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = handleClose;

      startedAtRef.current = performance.now();
      timersRef.current.tick = window.setInterval(
        () => setElapsedMs(performance.now() - startedAtRef.current),
        250,
      );
    },
    [handleClose, handleEvent],
  );

  const stop = useCallback(() => {
    const ws = wsRef.current;
    durationRef.current = performance.now() - startedAtRef.current;
    stopRecorder();
    if (!ws) {
      setStatus('idle');
      return;
    }
    setStatus('stopping');
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
    else ws.close();
    // The server closes the socket once the last final transcript is in; don't wait forever.
    timersRef.current.stop = window.setTimeout(() => ws.close(), STOP_TIMEOUT_MS);
  }, [stopRecorder]);

  useEffect(
    () => () => {
      const timers = timersRef.current;
      window.clearInterval(timers.tick);
      window.clearTimeout(timers.stop);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      void recorderRef.current?.stop();
    },
    [],
  );

  const clear = useCallback(() => {
    segmentsRef.current = [];
    setSegments([]);
    setPartial('');
    setError(null);
  }, []);

  return { status, segments, partial, error, level, speaking, elapsedMs, start, stop, clear };
}
