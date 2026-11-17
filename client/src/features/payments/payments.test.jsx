import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import WithdrawPage from '../../pages/app/WithdrawPage.jsx';
import { ToastProvider } from '../../context/ToastContext.jsx';
import { SESSION_KEY } from '../auth/useSession.js';
import { api } from '../../services/api.js';
import { INVESTOR_NAV } from '../../layouts/InvestorLayout.jsx';
import { ADMIN_NAV } from '../../layouts/AdminLayout.jsx';

const session = {
  user: { id: 'u1', email: 'ama@b.test', type: 'INDIVIDUAL', status: 'ACTIVE' },
  profile: { firstName: 'Ama', lastName: 'Mensah' },
  roles: [],
  permissions: ['withdrawals:create:own', 'wallet:read:own'],
  session: { id: 's1', mfaPending: false },
};

function renderWithdraw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(SESSION_KEY, session);
  qc.setQueryData(['platform'], { currencies: [{ code: 'GHS', minorUnits: 2 }] });
  const router = createMemoryRouter(
    [
      { path: '/app/withdraw', element: <WithdrawPage /> },
      { path: '/app/transactions', element: <p>transactions page</p> },
    ],
    { initialEntries: ['/app/withdraw'] },
  );
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('WithdrawPage', () => {
  it('confirms before sending, posts the destination with an Idempotency-Key, then shows transactions', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/wallet') return { data: { wallets: [{ currency: 'GHS', available: { amountMinor: '50000', currency: 'GHS' } }] } };
      return { data: {} };
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 'w1', status: 'REQUESTED' } });
    const user = userEvent.setup();
    renderWithdraw();

    await user.type(await screen.findByLabelText(/Amount/), '120.50');
    await user.type(screen.getByLabelText(/Mobile number/), '024-123 4567');
    expect(screen.getByLabelText(/Account name/)).toHaveValue('Ama Mensah');
    await user.click(screen.getByRole('button', { name: 'Review withdrawal' }));
    expect(post).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('MTN 0241234567');
    await user.click(within(dialog).getByRole('button', { name: 'Request withdrawal' }));

    expect(await screen.findByText('transactions page')).toBeInTheDocument();
    const [path, body, opts] = post.mock.calls[0];
    expect(path).toBe('/wallet/withdrawals');
    expect(body).toEqual({
      amount: '120.50',
      currency: 'GHS',
      method: 'MOBILE_MONEY',
      destination: { network: 'MTN', accountNumber: '0241234567', accountName: 'Ama Mensah' },
    });
    expect(opts.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('navigation', () => {
  it('lists the new investor and admin sections, with admin items gated by permission', () => {
    expect(INVESTOR_NAV.map((i) => i.to)).toEqual(expect.arrayContaining(['/app/transactions', '/app/investments', '/investments']));
    const byPath = Object.fromEntries(ADMIN_NAV.map((i) => [i.to, i.permission]));
    expect(byPath['/admin/payments']).toBe('withdrawals:read:any');
    expect(byPath['/admin/orders']).toBe('investments:orders:read:any');
  });
});
