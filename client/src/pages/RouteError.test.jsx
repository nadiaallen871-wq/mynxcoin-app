import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import RouteError from './RouteError.jsx';

function renderThrowing(error) {
  const Boom = () => {
    throw error;
  };
  const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <RouteError /> }]);
  return render(<RouterProvider router={router} />);
}

describe('RouteError', () => {
  it('explains stale code chunks after a release and offers a reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderThrowing(new TypeError('Failed to fetch dynamically imported module: /assets/Page-abc.js'));
    expect(await screen.findByText('A new version is available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('shows a generic message for other errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderThrowing(new Error('boom'));
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });
});
