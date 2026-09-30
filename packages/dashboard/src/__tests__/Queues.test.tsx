import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Queues from '../pages/Queues';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../api';

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);

describe('Queues page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/queues') return [];
      if (path === '/queues/failed') return [];
      if (path === '/queues/dead-letter') return [];
      return [];
    });
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
    expect(mockGet).toHaveBeenCalledWith('/queues/failed');
    expect(mockGet).toHaveBeenCalledWith('/queues/dead-letter');
  });

  it('renders queue data when loaded', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/queues') {
        return [
          { platform: 'telegram', waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1 },
        ];
      }
      return [];
    });
    render(<Queues />);
    await waitFor(() => {
      expect(screen.getAllByText('telegram').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders dead-letter jobs and replays one', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/queues/dead-letter') {
        return [
          {
            id: 'dlq-1',
            platform: 'twitch',
            name: 'connect',
            type: 'connect',
            botId: 'b1',
            failedReason: 'boom',
            attemptsMade: 3,
            timestamp: Date.now(),
          },
        ];
      }
      return [];
    });
    render(<Queues />);
    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
    const replayButton = screen.getAllByRole('button', { name: 'Replay' })[0];
    fireEvent.click(replayButton);
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/queues/dead-letter/twitch/dlq-1/replay');
    });
  });

  it('renders refresh button', async () => {
    render(<Queues />);
    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });
  });
});
