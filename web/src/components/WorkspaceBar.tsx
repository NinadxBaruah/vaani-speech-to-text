import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useToast } from '../hooks/useToast';
import { useWorkspace } from '../hooks/useWorkspace';
import { maskKey } from '../lib/workspaceKey';
import { KeyIcon } from './icons';

/** Shows the workspace key and lets the reviewer copy it, open another one, or start fresh. */
export function WorkspaceBar() {
  const { key, info, switchKey, newWorkspace } = useWorkspace();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function copy() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      notify('Workspace key copied');
    } catch {
      notify('Copy failed — select the key and copy it manually', 'error');
    }
  }

  async function onSwitch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await switchKey(draft);
      setDraft('');
      setOpen(false);
      notify('Workspace opened');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not open that workspace', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onNew() {
    if (
      !window.confirm(
        'Start a new, empty workspace? Copy your current key first if you want to come back to it.',
      )
    )
      return;
    setBusy(true);
    try {
      await newWorkspace();
      setOpen(false);
      notify('New workspace created');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create a workspace', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace" ref={rootRef}>
      <button
        type="button"
        className="workspace__chip"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        disabled={!key}
      >
        <KeyIcon />
        <span className="workspace__label">
          {info ? info.keyPrefix : key ? key.slice(0, 10) : 'Setting up…'}
        </span>
        {info && <span className="workspace__count">{info.transcriptCount}</span>}
      </button>

      {open && key && (
        <div className="workspace__panel" id={panelId} role="dialog" aria-label="Workspace key">
          <p className="workspace__intro">
            No sign-up needed. This key <strong>is</strong> your workspace: anyone with it can view,
            edit and delete these transcripts. Paste it in another browser to open the same history.
          </p>
          <div className="workspace__key">
            <code>{reveal ? key : maskKey(key)}</code>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setReveal((r) => !r)}
            >
              {reveal ? 'Hide' : 'Show'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={copy}>
              Copy
            </button>
          </div>

          <form className="workspace__switch" onSubmit={onSwitch}>
            <label htmlFor={`${panelId}-key`}>Open another workspace</label>
            <div className="row">
              <input
                id={`${panelId}-key`}
                className="input"
                placeholder="stt_…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn btn--sm" disabled={busy || !draft.trim()}>
                Open
              </button>
            </div>
          </form>

          <button
            type="button"
            className="btn btn--ghost btn--sm workspace__new"
            onClick={onNew}
            disabled={busy}
          >
            Start a new empty workspace
          </button>
        </div>
      )}
    </div>
  );
}
