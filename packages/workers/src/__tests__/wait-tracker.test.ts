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
    const t = new WaitTimeTracker(3);
    t.record(1000);
    t.record(2000);
    t.record(3000);
    t.record(4000); // evicts 1000
    expect(t.sizeCount).toBe(3);
    const { p50 } = t.percentiles();
    expect(p50).toBeCloseTo(3, 0);
  });
});
