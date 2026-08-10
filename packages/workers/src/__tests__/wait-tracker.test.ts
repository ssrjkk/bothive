import { describe, expect, it } from 'vitest';
import { WaitTimeTracker } from '../wait-tracker.js';

describe('WaitTimeTracker', () => {
  it('returns zeros before any sample', () => {
    const t = new WaitTimeTracker();
    expect(t.percentiles()).toEqual({ p50: 0, p95: 0, p99: 0 });
  });

  it('computes percentiles in seconds over the recorded wait times', () => {
    const t = new WaitTimeTracker();
    // 1s .. 100s wait times: p50 = 50s, p95 = 95s, p99 = 99s.
    for (let i = 1; i <= 100; i += 1) t.record(i * 1000);
    const { p50, p95, p99 } = t.percentiles();
    expect(p50).toBeCloseTo(50, 0);
    expect(p95).toBeCloseTo(95, 0);
    expect(p99).toBeCloseTo(99, 0);
  });

  it('drops negative and non-finite samples', () => {
    const t = new WaitTimeTracker();
    t.record(-1);
    t.record(Number.NaN);
    t.record(4000);
    expect(t.sizeCount).toBe(1);
    expect(t.percentiles()).toEqual({ p50: 4, p95: 4, p99: 4 });
  });

  it('keeps only the most recent samples once full', () => {
    const t = new WaitTimeTracker({ capacity: 3 });
    t.record(1000);
    t.record(2000);
    t.record(3000);
    t.record(4000); // evicts 1000
    expect(t.sizeCount).toBe(3);
    const { p50 } = t.percentiles();
    expect(p50).toBeCloseTo(3, 0);
  });

  it('ignores samples older than the time window', () => {
    const t = new WaitTimeTracker({ windowMs: 60_000 });
    const now = Date.now();
    // Burst from an hour ago: high waits that must not keep p95 elevated.
    for (let i = 1; i <= 50; i += 1) t.record(i * 1000, now - 3_600_000);
    // Recent healthy samples.
    for (let i = 1; i <= 50; i += 1) t.record(i * 100, now);
    const { p50, p95 } = t.percentiles();
    expect(p50).toBeGreaterThanOrEqual(2.5);
    expect(p50).toBeLessThan(30);
    expect(p95).toBeLessThan(5.1);
  });

  it('returns zeros when every sample is outside the window', () => {
    const t = new WaitTimeTracker({ windowMs: 60_000 });
    t.record(999_000, Date.now() - 3_600_000);
    expect(t.sizeCount).toBe(1);
    expect(t.percentiles()).toEqual({ p50: 0, p95: 0, p99: 0 });
  });

  it('guards against a zero capacity so the ring buffer stays sane', () => {
    const t = new WaitTimeTracker({ capacity: 0 });
    t.record(1000);
    t.record(2000);
    expect(t.sizeCount).toBe(1);
    const { p50 } = t.percentiles();
    expect(p50).toBeCloseTo(2, 0);
  });
});
