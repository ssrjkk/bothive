import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Scripts from '../pages/Scripts';

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

describe('Scripts page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue([]);
  });

  it('renders page header', async () => {
    render(<Scripts />);
    expect(screen.getByText('Scripts')).toBeInTheDocument();
  });

  it('fetches scripts on mount', async () => {
    render(<Scripts />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/scripts');
    });
  });

  it('renders scripts in table', async () => {
    mockGet.mockResolvedValue([
      { id: '1', name: 'Test Script', trigger: 'message', enabled: true, createdAt: '2024-01-01' },
    ]);
    render(<Scripts />);
    await waitFor(() => {
      expect(screen.getByText('Test Script')).toBeInTheDocument();
    });
  });

  it('renders empty state when no scripts', async () => {
    mockGet.mockResolvedValue([]);
    render(<Scripts />);
    await waitFor(() => {
      expect(screen.getByText(/No scripts yet/)).toBeInTheDocument();
    });
  });
});
