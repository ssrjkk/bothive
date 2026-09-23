import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import BotEditor from '../pages/BotEditor';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'bot-123' }),
  useNavigate: () => vi.fn(),
}));

import { api } from '../api';

const mockGet = vi.mocked(api.get);

describe('BotEditor page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((path: string) => {
      if (path.includes('/bots/')) {
        return Promise.resolve({
          id: 'bot-123',
          name: 'Test Bot',
          platform: 'telegram',
          status: 'running',
          config: {},
          account: { name: 'Test Account', platform: 'telegram', id: 'acc-1' },
          logs: [],
          scripts: [],
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
        });
      }
      if (path.includes('/scripts/patterns')) return Promise.resolve([]);
      if (path.includes('/memory')) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  it('fetches bot data on mount', async () => {
    render(<BotEditor />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/bots/bot-123');
    });
  });

  it('renders bot name when loaded', async () => {
    render(<BotEditor />);
    await waitFor(() => {
      expect(screen.getByText('Test Bot')).toBeInTheDocument();
    });
  });
});
