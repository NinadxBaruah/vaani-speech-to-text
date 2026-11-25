import { History } from './components/History';
import { Studio } from './components/Studio';
import { WorkspaceBar } from './components/WorkspaceBar';
import { useWorkspace } from './hooks/useWorkspace';

export function App() {
  const { problem, newWorkspace } = useWorkspace();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
            <rect width="32" height="32" rx="9" className="brand__tile" />
            <g className="brand__bars">
              <rect x="7" y="13" width="3" height="6" rx="1.5" />
              <rect x="12" y="9" width="3" height="14" rx="1.5" />
              <rect x="17" y="6" width="3" height="20" rx="1.5" />
              <rect x="22" y="11" width="3" height="10" rx="1.5" />
            </g>
          </svg>
          <div>
            <h1>Vaani</h1>
            <p className="muted">Real-time speech to text · Sarvam API or self-hosted Whisper</p>
          </div>
        </div>
        <WorkspaceBar />
      </header>

      {problem && (
        <div className="banner" role="alert">
          <span>{problem}</span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void newWorkspace().catch(() => undefined)}
          >
            Start a new workspace
          </button>
        </div>
      )}

      <main className="grid">
        <Studio />
        <History />
      </main>

      <footer className="footer muted">
        Audio goes through this server to the engine you pick: Sarvam’s API, or the open-source
        Whisper model running on this server. API keys never reach the browser. Transcripts are
        stored in Postgres under your workspace key.
      </footer>
    </div>
  );
}
