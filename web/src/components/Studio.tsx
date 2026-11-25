import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { useMeta } from '../hooks/useMeta';
import { useToast } from '../hooks/useToast';
import { useTranscriber, type FinishedRecording } from '../hooks/useTranscriber';
import { api, type EngineId, type EngineInfo } from '../lib/api';
import { formatDuration, languageName } from '../lib/format';
import { MicIcon, StopIcon } from './icons';

const PREFS_KEY = 'vaani.prefs';

interface Prefs {
  engine: EngineId;
  languageCode: string;
  mode: string;
}

interface Draft extends FinishedRecording, Prefs {
  title: string;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { engine: 'sarvam', languageCode: 'auto', mode: 'codemix' };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    return {
      engine: raw.engine === 'local' ? 'local' : 'sarvam',
      languageCode: typeof raw.languageCode === 'string' ? raw.languageCode : fallback.languageCode,
      mode: typeof raw.mode === 'string' ? raw.mode : fallback.mode,
    };
  } catch {
    return fallback;
  }
}

function EnginePicker({
  engines,
  value,
  disabled,
  onChange,
}: {
  engines: EngineInfo[];
  value: EngineId;
  disabled: boolean;
  onChange: (id: EngineId) => void;
}) {
  return (
    <fieldset className="engines" disabled={disabled}>
      <legend>Speech engine</legend>
      {engines.map((e) => (
        <label
          key={e.id}
          className={`engine${value === e.id ? ' engine--active' : ''}${e.available ? '' : ' engine--off'}`}
        >
          <input
            type="radio"
            name="engine"
            value={e.id}
            checked={value === e.id}
            disabled={!e.available}
            onChange={() => onChange(e.id)}
          />
          <span className="engine__top">
            <span className="engine__name">{e.label}</span>
            <span className={`engine__kind engine__kind--${e.kind}`}>
              {e.available ? (e.kind === 'self-hosted' ? 'Self-hosted' : 'Third-party') : 'Offline'}
            </span>
          </span>
          <span className="engine__summary">{e.summary}</span>
          <span className="engine__model">{e.model}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function Studio() {
  const meta = useMeta();
  const notify = useToast();
  const queryClient = useQueryClient();
  const ids = useId();

  const [prefs, setPrefs] = useState(loadPrefs);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const engines = meta.data?.engines ?? [];
  const localAvailable = engines.find((e) => e.id === 'local')?.available ?? false;
  // A remembered choice of the self-hosted engine falls back to Sarvam while it's offline.
  const engine: EngineId =
    prefs.engine === 'local' && meta.data && !localAvailable ? 'sarvam' : prefs.engine;
  const isLocal = engine === 'local';
  const settings = useMemo<Prefs>(() => ({ ...prefs, engine }), [prefs, engine]);

  const onFinished = useCallback(
    (rec: FinishedRecording) => setDraft({ ...rec, title: '', ...settings }),
    [settings],
  );
  const t = useTranscriber(onFinished);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      api.createTranscript({
        title: d.title.trim() || undefined,
        text: d.text.trim(),
        engine: d.engine,
        languageCode: d.engine === 'local' ? null : d.languageCode,
        detectedLanguages: d.detectedLanguages,
        mode: d.engine === 'local' ? 'transcribe' : d.mode,
        durationMs: Math.round(d.durationMs),
      }),
    onSuccess: () => {
      setDraft(null);
      t.clear();
      notify('Transcript saved');
      void queryClient.invalidateQueries({ queryKey: ['transcripts'] });
    },
    onError: (err) => notify(err.message, 'error'),
  });

  const recording = t.status !== 'idle';
  const canRecord = !draft;
  const modes = meta.data?.modes ?? [];
  const activeMode = modes.find((m) => m.id === prefs.mode);
  const liveText = t.segments.map((s) => s.text).join(' ');

  function toggle() {
    if (recording) t.stop();
    else void t.start(settings);
  }

  function onSave(e: FormEvent) {
    e.preventDefault();
    if (draft && draft.text.trim()) save.mutate(draft);
  }

  function discard() {
    setDraft(null);
    t.clear();
  }

  const statusLabel = {
    idle: draft ? 'Review and save' : 'Ready',
    connecting: isLocal ? 'Starting engine…' : 'Connecting…',
    live: t.speaking ? 'Hearing you' : 'Listening',
    stopping: 'Finishing…',
  }[t.status];

  const draftLanguages = draft
    ? draft.engine === 'local'
      ? 'Hinglish'
      : draft.detectedLanguages.length
        ? draft.detectedLanguages.map((c) => languageName(c, meta.data?.sttLanguages)).join(', ')
        : languageName(draft.languageCode, meta.data?.sttLanguages)
    : '';
  const draftEngine = engines.find((e) => e.id === draft?.engine)?.label;

  return (
    <section className="card studio" aria-labelledby={`${ids}-title`}>
      <header className="card__head">
        <div>
          <h2 id={`${ids}-title`}>Live transcription</h2>
          <p className="muted">
            {isLocal
              ? 'Speak Hindi, English or both — get Hinglish text.'
              : `Speak in any of ${meta.data?.sttLanguages.length ?? 23} Indian languages — or mix them.`}
          </p>
        </div>
        <span className={`status status--${t.status}${t.speaking ? ' status--speaking' : ''}`}>
          <span className="status__dot" aria-hidden="true" />
          {statusLabel}
        </span>
      </header>

      {engines.length > 0 && (
        <EnginePicker
          engines={engines}
          value={engine}
          disabled={recording || Boolean(draft)}
          onChange={(id) => setPrefs((p) => ({ ...p, engine: id }))}
        />
      )}

      {isLocal ? (
        <p className="engine-note">
          Runs <strong>Whisper Hindi→Hinglish</strong> (open-source, Apache-2.0) on this server’s
          CPU. It writes Hindi and English speech as Hinglish in Latin script, e.g. “kal ki meeting
          das baje hai”. Text appears in short bursts while you speak and is finalised at each
          pause.
        </p>
      ) : (
        <div className="studio__controls">
          <label className="field">
            <span>Language</span>
            <select
              className="input"
              value={prefs.languageCode}
              disabled={recording}
              onChange={(e) => setPrefs((p) => ({ ...p, languageCode: e.target.value }))}
            >
              <option value="auto">Auto-detect (mixed speech)</option>
              {meta.data?.sttLanguages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} · {l.nativeName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Output</span>
            <select
              className="input"
              value={prefs.mode}
              disabled={recording}
              onChange={(e) => setPrefs((p) => ({ ...p, mode: e.target.value }))}
            >
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {activeMode && <small className="muted">{activeMode.hint}</small>}
          </label>
        </div>
      )}

      <div className="studio__stage">
        <button
          type="button"
          className={`record${recording ? ' record--on' : ''}`}
          onClick={toggle}
          disabled={!canRecord || t.status === 'stopping'}
          aria-pressed={recording}
          style={{ '--level': Math.min(1, t.level * 6).toFixed(3) } as CSSProperties}
        >
          {recording ? <StopIcon width={30} height={30} /> : <MicIcon width={30} height={30} />}
          <span className="sr-only">{recording ? 'Stop recording' : 'Start recording'}</span>
        </button>
        <div className="studio__hint">
          {recording ? (
            <>
              <strong className="tabular">{formatDuration(t.elapsedMs) ?? '0s'}</strong>
              <span className="muted">Press stop when you are done</span>
            </>
          ) : draft ? (
            <span className="muted">Save or discard this transcript to record again</span>
          ) : (
            <span className="muted">Press the mic and start speaking</span>
          )}
        </div>
      </div>

      {t.error && (
        <p className="alert" role="alert">
          {t.error}
        </p>
      )}

      {draft ? (
        <form className="draft" onSubmit={onSave}>
          <label className="field">
            <span>Title</span>
            <input
              className="input"
              placeholder="Optional — we'll use the first words"
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Transcript</span>
            <textarea
              className="input transcript-text"
              rows={5}
              maxLength={20000}
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
          </label>
          <div className="draft__meta muted">
            {[formatDuration(draft.durationMs), draftLanguages, draftEngine]
              .filter(Boolean)
              .join(' · ')}
          </div>
          <div className="row row--end">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={discard}
              disabled={save.isPending}
            >
              Discard
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={save.isPending || !draft.text.trim()}
            >
              {save.isPending ? 'Saving…' : 'Save transcript'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="live transcript-text" aria-live="polite" aria-atomic="false">
            {liveText || t.partial ? (
              <>
                {liveText}
                {t.partial && <span className="live__partial"> {t.partial}</span>}
              </>
            ) : (
              <span className="live__placeholder">
                {isLocal
                  ? 'Try: “Kal ki meeting das baje hai, please sabko time pe join karne ko bolo.”'
                  : 'Try: “नमस्ते, kal ki meeting 10 baje hai, please join on time.”'}
              </span>
            )}
          </div>
          {recording && (
            <p className="live__note muted">
              {isLocal
                ? 'Grey text is a rough preview from the fast pass. The final text for each phrase arrives after you pause.'
                : 'Grey text is a quick live preview. It settles into the final transcript, in your chosen output style, each time you pause.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
