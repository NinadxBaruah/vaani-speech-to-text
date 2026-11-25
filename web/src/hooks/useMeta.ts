import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * Languages, modes, voices and engines come from the server so the UI never drifts from it.
 * Refreshed every minute so the self-hosted engine's online/offline state stays current.
 */
export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: api.meta,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
