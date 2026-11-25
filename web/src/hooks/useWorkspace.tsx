import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, type WorkspaceInfo } from '../lib/api';
import { KEY_PATTERN, loadKey, saveKey } from '../lib/workspaceKey';

/**
 * The "no account" model: every browser gets a workspace key on first visit (stored in
 * localStorage). Pasting a key elsewhere opens the same history. See docs/PLAN.md section 5.
 */

interface WorkspaceContextValue {
  key: string | null;
  info: WorkspaceInfo | undefined;
  /** First-visit creation failed, or the stored key is no longer valid. */
  problem: string | null;
  switchKey: (key: string) => Promise<void>;
  newWorkspace: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// Dedupes creation across StrictMode double effects and multiple callers.
let creating: Promise<string> | null = null;
function createKeyOnce(): Promise<string> {
  creating ??= api
    .createWorkspace()
    .then(({ key }) => {
      saveKey(key);
      return key;
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState<string | null>(() => loadKey());
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (key) return;
    let cancelled = false;
    createKeyOnce()
      .then((k) => !cancelled && setKey(k))
      .catch((err: unknown) => {
        if (!cancelled) {
          setCreateError(err instanceof Error ? err.message : 'Could not create a workspace');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const me = useQuery({
    queryKey: ['workspace', key],
    queryFn: () => api.me(key as string),
    enabled: Boolean(key),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
  });

  const invalidKey = me.error instanceof ApiError && me.error.status === 401;

  const switchKey = useCallback(
    async (raw: string) => {
      const next = raw.trim();
      if (!KEY_PATTERN.test(next))
        throw new Error('That does not look like a workspace key (stt_…).');
      await api.me(next); // throws 401 for unknown keys
      saveKey(next);
      setKey(next);
      await queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const newWorkspace = useCallback(async () => {
    setCreateError(null);
    const next = await createKeyOnce();
    setKey(next);
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      key,
      info: me.data,
      problem:
        createError ??
        (invalidKey
          ? 'This workspace key is not recognised. Start a new workspace or paste another key.'
          : null),
      switchKey,
      newWorkspace,
    }),
    [key, me.data, createError, invalidKey, switchKey, newWorkspace],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
