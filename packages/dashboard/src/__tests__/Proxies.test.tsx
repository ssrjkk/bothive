import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Proxies from '../pages/Proxies';

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
const mockPost = vi.mocked(api.post);
const mockPatch = vi.mocked(api.patch);
const mockDelete = vi.mocked(api.delete);

describe('Proxies page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue([]);
  });

  it('renders page header', async () => {
    render(<Proxies />);
    expect(screen.getByText('Proxies')).toBeInTheDocument();
  });

  it('fetches proxies on mount', async () => {
    render(<Proxies />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/proxies');
    });
  });

  it('renders proxies in table', async () => {
    mockGet.mockResolvedValue([
      {
        id: '1',
        url: 'http://proxy1.com:8080',
        type: 'http',
        priority: 1,
        enabled: true,
        healthScore: 95,
        requestsCount: 100,
        failureCount: 5,
        createdAt: '2024-01-01',
      },
    ]);
    render(<Proxies />);
    await waitFor(() => {
      expect(screen.getByText('http://proxy1.com:8080')).toBeInTheDocument();
    });
  });

  it('renders add proxy button', async () => {
    render(<Proxies />);
    await waitFor(() => {
      expect(screen.getAllByText('Add Proxy').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders empty state when no proxies', async () => {
    mockGet.mockResolvedValue([]);
    render(<Proxies />);
    await waitFor(() => {
      expect(screen.getByText(/No proxies configured/)).toBeInTheDocument();
    });
  });
});
