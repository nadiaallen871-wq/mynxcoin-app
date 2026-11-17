import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { ToastProvider } from './context/ToastContext.jsx';
import { createRouter } from './routes/index.jsx';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Client errors (4xx) are not retried. Network and 5xx errors get two retries.
        retry: (count, error) => !(error?.status >= 400 && error?.status < 500) && count < 2,
      },
      // Mutations (financial operations) are never auto-retried. The server's idempotency keys handle safe retries.
      mutations: { retry: false },
    },
  });
}

export default function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
