import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api.js';

export const SESSION_KEY = ['session'];

/**
 * The signed-in user as reported by the server (GET /users/session).
 * Resolves to null when signed out. Permissions are for UI decisions only:
 * the server enforces every permission on every request.
 */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async ({ signal }) => (await api.get('/users/session', { signal })).data,
    staleTime: 60_000,
    retry: false,
  });
}

export function hasPermission(session, ...keys) {
  return Boolean(session?.permissions) && keys.every((k) => session.permissions.includes(k));
}

export const isStaff = (session) => session?.user?.type === 'STAFF';

export function displayName(session) {
  const p = session?.profile;
  return p ? `${p.firstName} ${p.lastName}` : (session?.user?.email ?? '');
}

/** Clears every cached query so no data from the previous user lingers. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(SESSION_KEY, null);
    },
  });
}

export function useRefreshSession() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SESSION_KEY });
}
