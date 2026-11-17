import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { RequireAuth, RequirePermission } from './guards.jsx';
import { safeNext } from './AuthCard.jsx';
import { SESSION_KEY } from './useSession.js';
import { api } from '../../services/api.js';

const session = (overrides = {}) => ({
  user: { id: 'u1', email: 'a@b.test', type: 'INDIVIDUAL', status: 'ACTIVE' },
  profile: { firstName: 'Ama', lastName: 'Mensah' },
  roles: [],
  permissions: ['profile:read:own'],
  mfa: { enabled: false },
  session: { id: 's1', mfaPending: false, mfaVerified: false },
  ...overrides,
});

function renderAt(path, sessionValue, element) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(SESSION_KEY, sessionValue);
  const router = createMemoryRouter(
    [
      { path: '/login', element: <p>login page</p> },
      { path: '/login/verify', element: <p>mfa page</p> },
      { path: '/app/security', element: <p>security page</p> },
      { path: '/protected', element },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('safeNext', () => {
  it('only allows same-origin relative paths', () => {
    expect(safeNext('/app/security')).toBe('/app/security');
    expect(safeNext('//evil.example')).toBe('/app');
    expect(safeNext('https://evil.example')).toBe('/app');
    expect(safeNext(null)).toBe('/app');
  });
});

describe('RequireAuth', () => {
  it('redirects signed-out visitors to login', async () => {
    renderAt('/protected', null, <RequireAuth>secret</RequireAuth>);
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });

  it('sends MFA-pending sessions to the challenge', async () => {
    renderAt('/protected', session({ session: { id: 's', mfaPending: true } }), <RequireAuth>secret</RequireAuth>);
    expect(await screen.findByText('mfa page')).toBeInTheDocument();
  });

  it('renders for signed-in users', async () => {
    renderAt('/protected', session(), <RequireAuth>secret</RequireAuth>);
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });
});

describe('RequirePermission', () => {
  it('denies users without the permission', async () => {
    renderAt('/protected', session(), <RequirePermission permission="users:read:any">admin</RequirePermission>);
    expect(await screen.findByText(/don’t have access/)).toBeInTheDocument();
  });

  it('asks staff to enable MFA before staff tools render', async () => {
    const staff = session({ user: { type: 'STAFF' }, permissions: ['users:read:any'], session: { mfaPending: false, mfaVerified: false } });
    renderAt('/protected', staff, <RequirePermission permission="users:read:any">admin</RequirePermission>);
    expect(await screen.findByText('Two-factor authentication required')).toBeInTheDocument();
    expect(screen.queryByText('admin')).not.toBeInTheDocument();
  });

  it('renders for MFA-verified staff with the permission', async () => {
    const staff = session({ user: { type: 'STAFF' }, permissions: ['users:read:any'], session: { mfaPending: false, mfaVerified: true } });
    renderAt('/protected', staff, <RequirePermission permission="users:read:any">admin</RequirePermission>);
    expect(await screen.findByText('admin')).toBeInTheDocument();
  });
});

describe('api client CSRF handling', () => {
  it('fetches a CSRF token, sends it, and retries once with a fresh token when rejected', async () => {
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, { data: { csrfToken: 'token-1' } }))
      .mockResolvedValueOnce(json(403, { error: { code: 'CSRF_INVALID', message: 'bad' } }))
      .mockResolvedValueOnce(json(200, { data: { csrfToken: 'token-2' } }))
      .mockResolvedValueOnce(json(200, { data: { ok: true } }));

    const res = await api.post('/auth/login', { email: 'a@b.test', password: 'x' });
    expect(res.data.ok).toBe(true);
    expect(fetchMock.mock.calls[1][1].headers['X-CSRF-Token']).toBe('token-1');
    expect(fetchMock.mock.calls[3][1].headers['X-CSRF-Token']).toBe('token-2');
    expect(fetchMock.mock.calls.every(([, init]) => init.credentials === 'include')).toBe(true);
  });

  it('exposes every verb the app uses and sends uploads as multipart without a JSON content type', async () => {
    expect(Object.keys(api).sort()).toEqual(['delete', 'get', 'patch', 'post', 'put']);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ data: { csrfToken: 'token-x', ok: true } }));
    await api.put('/onboarding/address', { city: 'Accra' });
    const putCall = fetchMock.mock.calls.find(([, init]) => init.method === 'PUT');
    expect(putCall[1].headers['Content-Type']).toBe('application/json');
    expect(putCall[1].headers['X-CSRF-Token']).toBeTruthy();

    const form = new FormData();
    form.append('type', 'SELFIE');
    await api.post('/documents', form);
    const upload = fetchMock.mock.calls.find(([url]) => url.endsWith('/documents'));
    expect(upload[1].body).toBe(form);
    expect(upload[1].headers['Content-Type']).toBeUndefined();
  });
});
