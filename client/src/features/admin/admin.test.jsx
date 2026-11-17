import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import SettingsPage from '../../pages/admin/SettingsPage.jsx';
import { ADMIN_NAV } from '../../layouts/AdminLayout.jsx';
import { ToastProvider } from '../../context/ToastContext.jsx';
import { SESSION_KEY } from '../auth/useSession.js';
import { api } from '../../services/api.js';

const setting = (over) => ({
  group: 'Payments',
  type: 'money',
  description: 'Smallest deposit.',
  editable: true,
  sensitive: false,
  min: 100,
  max: 10_000_000,
  maxLength: null,
  default: 1000,
  overridden: false,
  version: 0,
  updatedAt: null,
  pending: null,
  ...over,
});

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(SESSION_KEY, { user: { id: 's1', type: 'STAFF' }, permissions: ['settings:read', 'settings:manage'], session: {} });
  qc.setQueryData(['platform'], { currencies: [{ code: 'GHS', minorUnits: 2 }] });
  const router = createMemoryRouter([{ path: '/admin/settings', element: <SettingsPage /> }], { initialEntries: ['/admin/settings'] });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('SettingsPage', () => {
  it('sends money settings as whole pesewas and never offers to edit locked settings', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: [
        setting({ key: 'payments.deposit_min_minor', value: 1000 }),
        setting({ key: 'platform.go_live_approved', group: 'Platform', type: 'boolean', value: false, editable: false, sensitive: true }),
      ],
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 'a1', status: 'PENDING' } });
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByLabelText('Not editable from the console')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Change' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('New value (GHS)');
    expect(input).toHaveValue('10.00');
    await user.clear(input);
    await user.type(input, '12.5');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Reduce tiny test deposits');
    await user.click(within(dialog).getByRole('button', { name: 'Request change' }));
    expect(post).toHaveBeenCalledWith('/admin/settings/payments.deposit_min_minor/proposals', {
      value: 1250,
      reason: 'Reduce tiny test deposits',
    });
  });
});

describe('admin navigation', () => {
  it('starts with the overview and gates every back-office section by permission', () => {
    expect(ADMIN_NAV[0]).toMatchObject({ to: '/admin/overview', permission: 'admin:dashboard' });
    const byPath = Object.fromEntries(ADMIN_NAV.map((i) => [i.to, i.permission]));
    expect(byPath).toMatchObject({
      '/admin/audit': 'audit:read',
      '/admin/settings': 'settings:read',
      '/admin/reports': 'reports:read',
      '/admin/messages': 'notifications:manage',
      '/admin/compliance': 'compliance:cases:read',
    });
    expect(ADMIN_NAV.every((i) => i.permission)).toBe(true);
  });
});
