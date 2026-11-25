import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMeta } from '../hooks/useMeta';
import { useToast } from '../hooks/useToast';
import { useWorkspace } from '../hooks/useWorkspace';
import { api, type Language, type Transcript } from '../lib/api';
import { formatDate, formatDuration, languageName } from '../lib/format';
import { CopyIcon, EditIcon, PlayIcon, StopIcon, TrashIcon } from './icons';

/** Picks a language TTS can speak: the chosen one, else the first detected one. */
function ttsLanguageFor(t: Transcript, ttsLanguages: Language[] | undefined): string | null {
  const supported = new Set(ttsLanguages?.map((l) => l.code));
  if (t.engine === 'local') return supported.has('hi-IN') ? 'hi-IN' : null; // Hinglish → Hindi voice
  const candidates = [t.languageCode, ...t.detectedLanguages].filter((c): c is string => !!c);
  return candidates.find((c) => supported.has(c)) ?? (t.mode === 'translate' ? 'en-IN' : null);
}

export function TranscriptItem({ transcript }: { transcript: Transcript }) {
  const { key } = useWorkspace();
  const meta = useMeta();
  const notify = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [title, setTitle] = useState(transcript.title);
  const [text, setText] = useState(transcript.text);
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['transcripts'] });
    void queryClient.invalidateQueries({ queryKey: ['workspace'] });
  };

  const update = useMutation({
    mutationFn: () =>
      api.updateTranscript(key as string, transcript.id, {
        title: title.trim(),
        text: text.trim(),
      }),
    onSuccess: () => {
      setEditing(false);
      notify('Changes saved');
      refresh();
    },
    onError: (err) => notify(err.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteTranscript(key as string, transcript.id),
    onSuccess: () => {
      notify('Transcript deleted');
      refresh();
    },
    onError: (err) => {
      setConfirmingDelete(false);
      notify(err.message, 'error');
    },
  });

  const ttsLanguage = ttsLanguageFor(transcript, meta.data?.ttsLanguages);
  const speak = useMutation({
    mutationFn: () =>
      api.speak(key as string, {
        text: transcript.text.slice(0, 2500),
        languageCode: ttsLanguage as string,
      }),
    onSuccess: (blob) => {
      stopAudio();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        setPlaying(false);
      };
      audio.onended = done;
      audio.onerror = done;
      setPlaying(true);
      audio.play().catch(done);
    },
    onError: (err) => notify(err.message, 'error'),
  });

  function stopAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  }

  useEffect(() => () => audioRef.current?.pause(), []);

  function startEdit() {
    setTitle(transcript.title);
    setText(transcript.text);
    setEditing(true);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;
    update.mutate();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(transcript.text);
      notify('Copied to clipboard');
    } catch {
      notify('Copy failed', 'error');
    }
  }

  const languageTags =
    transcript.engine === 'local'
      ? ['Hinglish']
      : (transcript.detectedLanguages.length
          ? transcript.detectedLanguages
          : transcript.languageCode
            ? [transcript.languageCode]
            : []
        ).map((c) => languageName(c, meta.data?.sttLanguages));
  const mode = meta.data?.modes.find((m) => m.id === transcript.mode)?.label ?? transcript.mode;
  const long = transcript.text.length > 280;
  const edited = transcript.updatedAt !== transcript.createdAt;

  if (editing) {
    return (
      <li className="item item--editing">
        <form onSubmit={onSubmit} className="stack">
          <label className="field">
            <span>Title</span>
            <input
              className="input"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Transcript</span>
            <textarea
              className="input transcript-text"
              rows={5}
              maxLength={20000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="row row--end">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary btn--sm"
              disabled={update.isPending || !title.trim() || !text.trim()}
            >
              {update.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={`item${remove.isPending ? ' item--leaving' : ''}`}>
      <div className="item__head">
        <h3 className="item__title">{transcript.title}</h3>
        <time className="item__date muted" dateTime={transcript.createdAt}>
          {formatDate(transcript.createdAt)}
        </time>
      </div>

      <p className={`item__text transcript-text${long && !expanded ? ' item__text--clamped' : ''}`}>
        {transcript.text}
      </p>
      {long && (
        <button type="button" className="link" onClick={() => setExpanded((x) => !x)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      <div className="item__foot">
        <div className="tags">
          {languageTags.map((name) => (
            <span key={name} className="tag">
              {name}
            </span>
          ))}
          {transcript.engine === 'local' ? (
            <span className="tag tag--engine" title="Oriserve/Whisper-Hindi2Hinglish-Swift">
              Self-hosted Whisper
            </span>
          ) : (
            <span className="tag tag--muted">{mode}</span>
          )}
          {formatDuration(transcript.durationMs) && (
            <span className="tag tag--muted">{formatDuration(transcript.durationMs)}</span>
          )}
          {edited && <span className="tag tag--muted">edited</span>}
        </div>

        {confirmingDelete ? (
          <div className="actions actions--confirm" role="group" aria-label="Confirm delete">
            <span>Delete this transcript?</span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              autoFocus
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        ) : (
          <div className="actions">
            <button
              type="button"
              className="icon-btn"
              onClick={() => (playing ? stopAudio() : speak.mutate())}
              disabled={!ttsLanguage || speak.isPending}
              title={
                ttsLanguage
                  ? playing
                    ? 'Stop'
                    : 'Listen (text to speech)'
                  : 'Text to speech is not available for this language'
              }
              aria-label={playing ? 'Stop playback' : 'Listen'}
            >
              {speak.isPending ? (
                <span className="spinner" aria-hidden="true" />
              ) : playing ? (
                <StopIcon />
              ) : (
                <PlayIcon />
              )}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={copy}
              title="Copy text"
              aria-label="Copy text"
            >
              <CopyIcon />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={startEdit}
              title="Edit"
              aria-label="Edit"
            >
              <EditIcon />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              onClick={() => setConfirmingDelete(true)}
              title="Delete"
              aria-label="Delete"
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
