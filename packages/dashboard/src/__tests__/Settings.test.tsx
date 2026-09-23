import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Settings from '../pages/Settings';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    changePassword: vi.fn(),
    logout: vi.fn(),
  },
}));

import { api } from '../api';

const mockGet = vi.mocked(api.get);
const mockChangePassword = vi.mocked(api.changePassword);
const mockLogout = vi.mocked(api.logout);

describe('Settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((path: string) => {
      if (path === '/queues') return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  it('renders page header', async () => {
    render(<Settings />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('fetches settings on mount', async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/queues');
    });
  });

  it('renders queue metrics table', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/queues') {
        return Promise.resolve([
          { platform: 'telegram', waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1 },
        ]);
      }
      return Promise.resolve({});
    });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Queue Metrics')).toBeInTheDocument();
    });
  });

  it('handles password change success', async () => {
    mockChangePassword.mockResolvedValueOnce({});
    render(<Settings />);

    const form = screen.getByText('Update Password').closest('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalled();
    });
  });

  it('handles password change error', async () => {
    mockChangePassword.mockRejectedValueOnce(new Error('Wrong password'));
    render(<Settings />);

    const form = screen.getByText('Update Password').closest('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalled();
    });
  });

  it('handles export backup', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/backup/export') return Promise.resolve({ accounts: [], bots: [] });
      if (path === '/queues') return Promise.resolve([]);
      return Promise.resolve({});
    });

    render(<Settings />);
    const exportButton = screen.getByText('Export Backup');
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/backup/export');
    });
  });

  it('handles logout', async () => {
    mockLogout.mockResolvedValueOnce(undefined);
    render(<Settings />);

    const logoutButton = screen.getByText('Logout');
    fireEvent.click(logoutButton);

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });
  });
});
