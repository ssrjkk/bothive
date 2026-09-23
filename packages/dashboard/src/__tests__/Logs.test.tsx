import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Logs from '../pages/Logs';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
  },
  BASE: '/api',
}));

import { api } from '../api';

const mockGet = vi.mocked(api.get);

describe('Logs page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((path: string) => {
      if (path.startsWith('/logs')) return Promise.resolve({ logs: [], total: 0 });
      if (path.startsWith('/bots')) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  it('renders page header', async () => {
    render(<Logs />);
    expect(screen.getByText('Logs')).toBeInTheDocument();
  });

  it('fetches logs on mount', async () => {
    render(<Logs />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/logs'));
    });
  });

  it('fetches bots for filter dropdown', async () => {
    render(<Logs />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/bots');
    });
  });

  it('renders log entries when loaded', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path.startsWith('/logs')) {
        return Promise.resolve({
          logs: [
            {
              id: '1',
              botId: 'bot-1',
              level: 'info',
              message: 'Test log message',
              meta: null,
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
          total: 1,
        });
      }
      if (path.startsWith('/bots')) return Promise.resolve([]);
      return Promise.resolve({});
    });
    render(<Logs />);
    await waitFor(() => {
      expect(screen.getByText('Test log message')).toBeInTheDocument();
    });
  });

  it('renders filter controls', async () => {
    render(<Logs />);
    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeInTheDocument();
    });
  });

  it('renders live mode toggle', async () => {
    render(<Logs />);
    await waitFor(() => {
      expect(screen.getByText('Live')).toBeInTheDocument();
    });
  });
});
