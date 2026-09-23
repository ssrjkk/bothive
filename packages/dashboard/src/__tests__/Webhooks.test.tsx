import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Webhooks from '../pages/Webhooks';

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

describe('Webhooks page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue([]);
  });

  it('renders page header', async () => {
    render(<Webhooks />);
    expect(screen.getByText('Webhooks')).toBeInTheDocument();
  });

  it('fetches webhooks on mount', async () => {
    render(<Webhooks />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/webhooks');
    });
  });

  it('renders webhooks in table', async () => {
    mockGet.mockResolvedValue([
      {
        id: '1',
        name: 'Test Hook',
        url: 'https://example.com/hook',
        events: ['message'],
        enabled: true,
        createdAt: '2024-01-01',
      },
    ]);
    render(<Webhooks />);
    await waitFor(() => {
      expect(screen.getByText('Test Hook')).toBeInTheDocument();
    });
  });

  it('renders create webhook button', async () => {
    render(<Webhooks />);
    await waitFor(() => {
      expect(screen.getAllByText('Create Webhook').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders empty state when no webhooks', async () => {
    mockGet.mockResolvedValue([]);
    render(<Webhooks />);
    await waitFor(() => {
      expect(screen.getByText(/No webhooks yet/)).toBeInTheDocument();
    });
  });
});
