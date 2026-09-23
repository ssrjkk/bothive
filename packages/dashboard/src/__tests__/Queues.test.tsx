import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Queues from '../pages/Queues';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '../api';

const mockGet = vi.mocked(api.get);

describe('Queues page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue([]);
  });

  it('renders page header', async () => {
    render(<Queues />);
    expect(screen.getByText('Queues')).toBeInTheDocument();
  });

  it('fetches queue metrics on mount', async () => {
    render(<Queues />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/queues');
    });
  });

  it('renders queue data when loaded', async () => {
    mockGet.mockResolvedValue([
      { platform: 'telegram', waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1 },
    ]);
    render(<Queues />);
    await waitFor(() => {
      expect(screen.getAllByText('telegram').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders refresh button', async () => {
    render(<Queues />);
    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });
  });
});
