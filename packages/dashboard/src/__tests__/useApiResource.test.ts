import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useApiResource } from '../hooks/useApiResource';

describe('useApiResource', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads data on mount', async () => {
    const loader = vi.fn().mockResolvedValue({ id: 1, name: 'test' });
    const { result } = renderHook(() => useApiResource(loader));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual({ id: 1, name: 'test' });
    expect(result.current.error).toBeNull();
  });

  it('surfaces loader errors', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useApiResource(loader));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Network error');
  });

  it('reloads data on demand', async () => {
    let count = 0;
    const loader = vi.fn().mockImplementation(() => Promise.resolve({ count: ++count }));
    const { result } = renderHook(() => useApiResource(loader));

    await waitFor(() => {
      expect(result.current.data).toEqual({ count: 1 });
    });

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.data).toEqual({ count: 2 });
  });

  it('allows manual data updates via setData', async () => {
    const loader = vi.fn().mockResolvedValue({ id: 1 });
    const { result } = renderHook(() => useApiResource(loader));

    await waitFor(() => {
      expect(result.current.data).toEqual({ id: 1 });
    });

    act(() => {
      result.current.setData({ id: 2 });
    });

    expect(result.current.data).toEqual({ id: 2 });
  });

  it('re-runs loader when deps change', async () => {
    const loader = vi.fn().mockImplementation((filter: string) => Promise.resolve({ filter }));
    let filter = 'a';
    const { result, rerender } = renderHook(() =>
      useApiResource(() => loader(filter), { deps: [filter] }),
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ filter: 'a' });
    });

    filter = 'b';
    rerender();

    await waitFor(() => {
      expect(result.current.data).toEqual({ filter: 'b' });
    });

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('polls on interval when intervalMs is set', async () => {
    vi.useFakeTimers();
    let count = 0;
    const loader = vi.fn().mockImplementation(() => Promise.resolve({ count: ++count }));
    const { result } = renderHook(() => useApiResource(loader, { intervalMs: 5000 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.data).toEqual({ count: 1 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.data).toEqual({ count: 2 });
  });

  it('keeps data visible on refetch when silentRefetch is true', async () => {
    let shouldFail = false;
    const loader = vi.fn().mockImplementation(() => {
      if (shouldFail) return Promise.reject(new Error('Transient error'));
      return Promise.resolve({ id: 1 });
    });

    const { result } = renderHook(() => useApiResource(loader, { silentRefetch: true }));

    await waitFor(() => {
      expect(result.current.data).toEqual({ id: 1 });
    });

    shouldFail = true;
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.data).toEqual({ id: 1 });
    expect(result.current.error).toBeNull();
  });

  it('shows loading on reload when refetchLoading is true', async () => {
    let resolveLoader!: (value: unknown) => void;
    let callCount = 0;
    const loader = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ id: 1 });
      return new Promise((resolve) => {
        resolveLoader = resolve;
      });
    });

    const { result } = renderHook(() => useApiResource(loader, { refetchLoading: true }));

    await waitFor(() => {
      expect(result.current.data).toEqual({ id: 1 });
    });

    let reloadPromise: Promise<void>;
    act(() => {
      reloadPromise = result.current.reload() as Promise<void>;
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveLoader({ id: 2 });
      await reloadPromise;
    });

    expect(result.current.loading).toBe(false);
  });

  it('ignores stale responses when loader is called multiple times', async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const loader = vi.fn().mockReturnValueOnce(firstPromise).mockResolvedValueOnce({ id: 2 });

    const { result } = renderHook(() => useApiResource(loader));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.data).toEqual({ id: 2 });

    await act(async () => {
      resolveFirst({ id: 1 });
    });

    expect(result.current.data).toEqual({ id: 2 });
  });

  it('handles non-Error rejections', async () => {
    const loader = vi.fn().mockRejectedValue('string error');
    const { result } = renderHook(() => useApiResource(loader));

    await waitFor(() => {
      expect(result.current.error).toBe('string error');
    });
  });
});
