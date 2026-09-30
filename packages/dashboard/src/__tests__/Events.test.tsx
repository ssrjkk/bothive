import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Events from '../pages/Events';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  BASE: '/api',
}));

import { api } from '../api';

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);
const mockDelete = vi.mocked(api.delete);

const EMPTY_STATS = { total: 0, replayed: 0, byType: [], byPlatform: [] };

const EVENT = {
  id: 'e1',
  botId: 'b1',
  platform: 'twitch',
  type: 'follow',
  version: 1,
  eventId: 'evt-1',
  payload: { username: 'alice' },
  replayCount: 0,
  lastReplayedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function mockEventsFetch(events: unknown[], total?: number) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: events, total: total ?? events.length }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Events page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockEventsFetch([]);
    mockGet.mockResolvedValue(EMPTY_STATS);
  });

  it('renders page header', () => {
    render(<Events />);
    expect(screen.getByText('Events')).toBeInTheDocument();
  });

  it('fetches stored events on mount', async () => {
    const fetchMock = mockEventsFetch([]);
    render(<Events />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/events');
    });
  });

  it('shows the store total when more events exist than loaded', async () => {
    mockEventsFetch([EVENT], 250);
    render(<Events />);
    await waitFor(() => {
      expect(screen.getByText(/showing 1 of 250/)).toBeInTheDocument();
    });
  });

  it('renders events and replays one', async () => {
    mockEventsFetch([EVENT]);
    render(<Events />);
    await waitFor(() => {
      expect(screen.getByText('follow')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /replay/i }));
    // The antd mock renders each Popconfirm inline with an OK button; the row
    // has two (replay + delete), so pick the first.
    fireEvent.click(screen.getAllByTestId('popconfirm-ok')[0]);
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/events/e1/replay');
    });
  });

  it('deletes an event', async () => {
    mockEventsFetch([EVENT]);
    render(<Events />);
    await waitFor(() => {
      expect(screen.getByText('follow')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    fireEvent.click(screen.getAllByTestId('popconfirm-ok')[1]);
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/events/e1');
    });
  });

  it('opens the payload drawer on view', async () => {
    mockEventsFetch([EVENT]);
    render(<Events />);
    await waitFor(() => {
      expect(screen.getByText('follow')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /view/i }));
    await waitFor(() => {
      expect(screen.getByText(/alice/)).toBeInTheDocument();
    });
  });
});
