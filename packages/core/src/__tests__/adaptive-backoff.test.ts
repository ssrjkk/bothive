import { describe, it, expect } from 'vitest';
import { calculateBackoff, DEFAULT_BACKOFF_MAX_MS } from '../resilience/adaptive-backoff.js';

describe('calculateBackoff', () => {
  it('returns the base delay for the first attempt with no jitter', () => {
    expect(calculateBackoff(0, 0, { random: () => 0 })).toBe(1000);
  });

  it('doubles exponentially with each attempt', () => {
    const rand = () => 0;
    expect(calculateBackoff(1, 0, { random: rand })).toBe(2000);
    expect(calculateBackoff(2, 0, { random: rand })).toBe(4000);
    expect(calculateBackoff(4, 0, { random: rand })).toBe(16_000);
  });

  it('scales the delay up with the failure rate', () => {
    const rand = () => 0;
    const healthy = calculateBackoff(2, 0, { random: rand });
    const failing = calculateBackoff(2, 0.5, { random: rand });
    expect(failing).toBeCloseTo(healthy * 1.5);
    expect(calculateBackoff(2, 1, { random: rand })).toBeCloseTo(healthy * 2);
  });

  it('adds jitter within the configured ratio', () => {
    const base = calculateBackoff(0, 0, { random: () => 0 });
    const jittered = calculateBackoff(0, 0, { random: () => 1 });
    expect(jittered).toBeCloseTo(base * (1 + 0.1));
  });

  it('clamps the result at the max delay', () => {
    const rand = () => 1;
    const huge = calculateBackoff(20, 1, { random: rand });
    expect(huge).toBe(DEFAULT_BACKOFF_MAX_MS);
  });

  it('supports a custom base delay and cap', () => {
    const rand = () => 0;
    expect(calculateBackoff(0, 0, { random: rand, baseDelayMs: 250 })).toBe(250);
    expect(calculateBackoff(10, 0, { random: rand, baseDelayMs: 250, maxDelayMs: 4000 })).toBe(
      4000,
    );
  });

  it('clamps negative attempts to 0 and clamps out-of-range failure rates', () => {
    const rand = () => 0;
    // failure rate 2 is clamped to 1 -> 1000 * 2
    expect(calculateBackoff(-5, 2, { random: rand })).toBe(2000);
    // negative failure rate is clamped to 0
    expect(calculateBackoff(0, -1, { random: rand })).toBe(1000);
  });
});
