import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Dashboard from '../pages/Dashboard';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => children,
  BarChart: ({ children }: any) => children,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Cell: () => null,
}));

import { api } from '../api';

const mockGet = vi.mocked(api.get);

describe('Dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((path: string) => {
      if (path === '/stats') return Promise.resolve({ byPlatform: [], byStatus: [] });
      if (path.startsWith('/logs')) return Promise.resolve({ logs: [] });
      if (path === '/health/workers') return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  it('renders page header', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('Bots by Platform')).toBeInTheDocument();
    });
  });

  it('fetches dashboard data on mount', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
  });
});
