import { describe, it, expect } from 'vitest';
import { HealthScoreTracker } from '../resilience/health-score.js';

const T0 = 1_000_000;
const clock = { t: T0 };

function makeTracker(windowMs = 3_600_000): HealthScoreTracker {
  clock.t = T0;
  return new HealthScoreTracker({ windowMs, now: () => clock.t });
}

const advance = (ms: number): void => {
  clock.t += ms;
};

describe('HealthScoreTracker', () => {
  it('reports 100 with no data and a 0 failure rate', () => {
    const tracker = makeTracker();
    expect(tracker.getScore()).toBe(100);
    expect(tracker.getFailureRate()).toBe(0);
  });

  it('scores 100 for all-success windows', () => {
    const tracker = makeTracker();
    tracker.recordSuccess();
    tracker.recordSuccess();
    expect(tracker.getScore()).toBe(100);
  });

  it('scores proportional to the success ratio', () => {
    const tracker = makeTracker();
    tracker.recordSuccess();
    tracker.recordFailure();
    expect(tracker.getScore()).toBe(50);
    expect(tracker.getFailureRate()).toBe(0.5);
  });

  it('rounds the score to an integer', () => {
    const tracker = makeTracker();
    for (let i = 0; i < 3; i++) tracker.recordSuccess();
    tracker.recordFailure();
    expect(tracker.getScore()).toBe(75);
  });

  it('drops outcomes older than the window', () => {
    const tracker = makeTracker(3_600_000);
    tracker.recordSuccess();
    advance(3_600_001);
    tracker.recordFailure();

    // only the failure is still inside the window
    expect(tracker.getTotal()).toBe(1);
    expect(tracker.getScore()).toBe(0);
  });

  it('keeps outcomes strictly inside the window and drops them at the edge', () => {
    const tracker = makeTracker(100);
    tracker.recordSuccess();
    advance(99);
    expect(tracker.getTotal()).toBe(1);
    advance(1);
    // outcome is now exactly windowMs old and falls out of the window
    expect(tracker.getTotal()).toBe(0);
  });

  it('reset() clears all outcomes back to a clean 100', () => {
    const tracker = makeTracker();
    tracker.recordFailure();
    expect(tracker.getScore()).toBe(0);
    tracker.reset();
    expect(tracker.getScore()).toBe(100);
  });
});
