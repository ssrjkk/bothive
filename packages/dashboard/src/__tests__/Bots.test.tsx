import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Bots from '../pages/Bots';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  BASE: '/api',
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

import { api } from '../api';

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);
const mockDelete = vi.mocked(api.delete);

describe('Bots page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue([]);
  });

  it('renders page header', async () => {
    render(<Bots />);
    expect(screen.getByText('Bots')).toBeInTheDocument();
  });

  it('fetches bots on mount', async () => {
    render(<Bots />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/bots');
    });
  });

  it('renders bots in table', async () => {
    mockGet.mockResolvedValue([
      {
        id: '1',
        name: 'Test Bot',
        platform: 'telegram',
        status: 'running',
        createdAt: '2024-01-01',
      },
    ]);
    render(<Bots />);
    await waitFor(() => {
      expect(screen.getByText('Test Bot')).toBeInTheDocument();
    });
  });

  it('renders create bot button', async () => {
    render(<Bots />);
    await waitFor(() => {
      expect(screen.getByText('Create Bot')).toBeInTheDocument();
    });
  });

  it('renders empty state when no bots', async () => {
    mockGet.mockResolvedValue([]);
    render(<Bots />);
    await waitFor(() => {
      expect(screen.getByText('No bots match your filters')).toBeInTheDocument();
    });
  });
});
