import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AllocationBars } from './charts.jsx';
import RegisterPage from '../../pages/auth/RegisterPage.jsx';
import NotificationsPage from '../../pages/app/NotificationsPage.jsx';
import { ToastProvider } from '../../context/ToastContext.jsx';
import { api } from '../../services/api.js';

function renderAt(path, routePath, element) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['platform'], { currencies: [{ code: 'GHS', minorUnits: 2 }] });
  const router = createMemoryRouter([{ path: routePath, element }], { initialEntries: [path] });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('AllocationBars', () => {
  it('states each group’s value and share as text, so colour is never the only signal', () => {
    renderAt(
      '/',
      '/',
      <AllocationBars
        groups={[
          { key: 'TREASURY_BILL', label: 'Treasury bill', valueMinor: '75000', shareBasisPoints: 7500 },
          { key: 'BOND', label: 'Bond', valueMinor: '25000', shareBasisPoints: 2500 },
        ]}
      />,
    );
    expect(screen.getByText('Treasury bill')).toBeInTheDocument();
    expect(screen.getByText(/75\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/25\.0%/)).toBeInTheDocument();
  });
});

describe('RegisterPage', () => {
  it('pre-fills the referral code from a referral link and strips unsafe characters', async () => {
    renderAt('/register?ref=ABCD2345<x>', '/register', <RegisterPage />);
    expect(await screen.findByLabelText(/Referral code/)).toHaveValue('ABCD2345x');
  });
});

describe('Notification preferences', () => {
  it('shows security email as always on', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/notifications/preferences') {
        return {
          data: [
            { category: 'SECURITY', email: true, sms: false, inApp: true, emailLocked: true },
            { category: 'PAYMENTS', email: true, sms: false, inApp: true, emailLocked: false },
          ],
        };
      }
      return { data: [], meta: { unread: 0, total: 0 } };
    });
    renderAt('/app/notifications?tab=preferences', '/app/notifications', <NotificationsPage />);
    expect(await screen.findByLabelText('Security: email')).toBeDisabled();
    expect(screen.getByLabelText('Deposits and withdrawals: email')).toBeEnabled();
    expect(screen.getByLabelText('Always on')).toBeInTheDocument();
  });
});
