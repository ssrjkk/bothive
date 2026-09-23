import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Users from '../pages/Users';

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

describe('Users page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((path: string) => {
      if (path.startsWith('/auth/users')) return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  it('renders page header', async () => {
    render(<Users />);
    expect(screen.getByText('Users')).toBeInTheDocument();
  });

  it('fetches users on mount', async () => {
    render(<Users />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/auth/users');
    });
  });

  it('renders empty table when no users', async () => {
    mockGet.mockResolvedValue([]);
    render(<Users />);
    await waitFor(() => {
      expect(screen.getByText('Users')).toBeInTheDocument();
    });
  });

  it('renders users in table when data loaded', async () => {
    mockGet.mockResolvedValue([
      {
        id: '1',
        email: 'user1@test.com',
        name: 'User One',
        role: 'viewer',
        createdAt: '2024-01-01',
      },
      {
        id: '2',
        email: 'user2@test.com',
        name: 'User Two',
        role: 'admin',
        createdAt: '2024-01-02',
      },
    ]);
    render(<Users />);
    await waitFor(() => {
      expect(screen.getByText('user1@test.com')).toBeInTheDocument();
      expect(screen.getByText('user2@test.com')).toBeInTheDocument();
    });
  });

  it('renders create user button', async () => {
    render(<Users />);
    await waitFor(() => {
      expect(screen.getAllByText('Create User').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays user roles correctly', async () => {
    mockGet.mockResolvedValue([
      {
        id: '1',
        email: 'admin@test.com',
        name: 'Admin User',
        role: 'admin',
        createdAt: '2024-01-01',
      },
    ]);
    render(<Users />);
    await waitFor(() => {
      expect(screen.getByText('admin')).toBeInTheDocument();
    });
  });
});
