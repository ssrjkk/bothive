import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Accounts from '../pages/Accounts';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '../api';

const mockGet = vi.mocked(api.get);

describe('Accounts page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue([]);
  });

  it('renders page header', async () => {
    render(<Accounts />);
    expect(screen.getByText('Accounts')).toBeInTheDocument();
  });

  it('fetches accounts on mount', async () => {
    render(<Accounts />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/accounts');
    });
  });

  it('renders accounts in table', async () => {
    mockGet.mockResolvedValue([
      {
        id: '1',
        platform: 'telegram',
        name: 'testbot',
        status: 'running',
        credentials: {},
        _count: { bots: 0 },
        createdAt: '2024-01-01',
      },
    ]);
    render(<Accounts />);
    await waitFor(() => {
      expect(screen.getByText('testbot')).toBeInTheDocument();
    });
  });
});
