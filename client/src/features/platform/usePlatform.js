import { useQuery } from '@tanstack/react-query';
import { api, BASE } from '../../services/api.js';

/** Platform mode and currencies. The server is the single source of truth for sandbox vs live. */
export function usePlatform() {
  return useQuery({
    queryKey: ['platform'],
    queryFn: ({ signal }) => api.get('/platform', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ['health', 'ready'],
    // A 503 from /ready still carries a useful body, so it is read either way.
    queryFn: async ({ signal }) => {
      const res = await fetch(`${BASE}/api/v1/health/ready`, { signal, headers: { Accept: 'application/json' } });
      if (!res.headers.get('content-type')?.includes('application/json')) throw new Error(`Health endpoint returned ${res.status}`);
      return res.json();
    },
    refetchInterval: 15_000,
  });
}
