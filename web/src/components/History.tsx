import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { api } from '../lib/api';
import { SearchIcon } from './icons';
import { TranscriptItem } from './TranscriptItem';

const PAGE_SIZE = 10;

export function History() {
  const ids = useId();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  // Debounce typing into the actual query.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const list = useQuery({
    queryKey: ['transcripts', query, page],
    queryFn: () =>
      api.listTranscripts({
        q: query || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    // Shared history: pick up what other people save without a manual refresh.
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = list.data?.items ?? [];

  // If the last item on a page was deleted, step back a page (state adjustment during render).
  if (list.data && !list.isPlaceholderData && items.length === 0 && page > 0) setPage(page - 1);

  return (
    <section className="card history" aria-labelledby={`${ids}-title`}>
      <header className="card__head">
        <div>
          <h2 id={`${ids}-title`}>History</h2>
          <p className="muted">
            {total} saved transcript{total === 1 ? '' : 's'} · shared with everyone
          </p>
        </div>
      </header>

      <label className="search">
        <SearchIcon />
        <span className="sr-only">Search transcripts</span>
        <input
          className="input"
          type="search"
          placeholder="Search titles and text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      {list.isPending ? (
        <ul className="list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="item item--skeleton" />
          ))}
        </ul>
      ) : list.isError ? (
        <p className="alert" role="alert">
          {list.error.message}{' '}
          <button type="button" className="link" onClick={() => void list.refetch()}>
            Retry
          </button>
        </p>
      ) : items.length === 0 ? (
        <div className="empty">
          {query ? (
            <p>No transcripts match “{query}”.</p>
          ) : (
            <>
              <p>
                <strong>Nothing saved yet.</strong>
              </p>
              <p className="muted">Record something on the left and press “Save transcript”.</p>
            </>
          )}
        </div>
      ) : (
        <ul className={`list${list.isPlaceholderData ? ' list--stale' : ''}`}>
          {items.map((t) => (
            <TranscriptItem key={`${t.id}:${t.updatedAt}`} transcript={t} />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="Pagination">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span className="muted tabular">
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
