import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ResilienceForm } from '../components/ResilienceForm';

vi.mock('../api', () => ({
  api: {
    patch: vi.fn(),
  },
}));

import { api } from '../api';

const mockPatch = vi.mocked(api.patch);

const BOT = {
  id: 'b1',
  config: {
    rateLimitPerMinute: 5,
    rateLimitBudgets: {
      default: { maxRequests: 30, windowMs: 60_000 },
      overrides: { tweet: { maxRequests: 17, windowMs: 900_000 } },
    },
    behavior: { enabled: true, humanDelay: { scale: 2 } },
    warming: { durationDays: 7, maxDailyActions: 10, maxDailyPosts: 3, firstPostDay: 2 },
  },
};

describe('ResilienceForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-fills from the bot config', () => {
    render(<ResilienceForm bot={BOT} onSaved={() => {}} />);
    expect(screen.getByText('Outbound rate limits')).toBeInTheDocument();
    expect(screen.getByText('Human-like behavior')).toBeInTheDocument();
    expect(screen.getByText('Account warming')).toBeInTheDocument();
    // pre-filled budget override row
    expect(screen.getByDisplayValue('tweet')).toBeInTheDocument();
    expect(screen.getByDisplayValue(17)).toBeInTheDocument();
  });

  it('saves a merge of the resilience settings into the config', async () => {
    const onSaved = vi.fn();
    render(<ResilienceForm bot={BOT} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: /save resilience settings/i }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/bots/b1', {
        config: expect.objectContaining({
          rateLimitPerMinute: 5,
          rateLimitBudgets: expect.objectContaining({
            default: { maxRequests: 30, windowMs: 60_000 },
            overrides: { tweet: { maxRequests: 17, windowMs: 900_000 } },
          }),
          behavior: expect.objectContaining({ enabled: true }),
          warming: { durationDays: 7, maxDailyActions: 10, maxDailyPosts: 3, firstPostDay: 2 },
        }),
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('can add a budget override row', async () => {
    render(<ResilienceForm bot={BOT} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add budget override/i }));
    const rows = screen.getAllByPlaceholderText('action (e.g. tweet)');
    expect(rows.length).toBe(2);
  });
});
