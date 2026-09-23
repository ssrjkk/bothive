import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CountUp } from '../components/CountUp';

describe('CountUp', () => {
  let rafCallback: FrameRequestCallback | null;

  beforeEach(() => {
    rafCallback = null;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafCallback = cb;
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('performance', { now: () => 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders initial value of 0', () => {
    render(<CountUp value={100} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('animates towards target value', () => {
    render(<CountUp value={100} duration={1000} />);
    expect(rafCallback).not.toBeNull();

    act(() => {
      vi.stubGlobal('performance', { now: () => 500 });
      rafCallback!(500);
    });

    const displayed = screen.getByText(/\d+/);
    const num = Number(displayed.textContent);
    expect(num).toBeGreaterThan(0);
    expect(num).toBeLessThanOrEqual(100);
  });

  it('reaches final value after duration', () => {
    render(<CountUp value={100} duration={1000} />);

    act(() => {
      vi.stubGlobal('performance', { now: () => 1000 });
      rafCallback!(1000);
    });

    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('formats large numbers with locale', () => {
    render(<CountUp value={1000000} duration={100} />);

    act(() => {
      vi.stubGlobal('performance', { now: () => 100 });
      rafCallback!(100);
    });

    const text = screen.getByText(/[\d,]+/);
    expect(text.textContent).toMatch(/1.*000.*000/);
  });

  it('cancels animation on unmount', () => {
    const { unmount } = render(<CountUp value={100} />);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it('restarts animation when value changes', () => {
    const { rerender } = render(<CountUp value={50} duration={1000} />);

    act(() => {
      vi.stubGlobal('performance', { now: () => 1000 });
      rafCallback!(1000);
    });

    expect(screen.getByText('50')).toBeInTheDocument();

    rerender(<CountUp value={100} duration={1000} />);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });
});
