/**
 * Sliding-window bot health score.
 *
 * Tracks the recent outcome of connects, reconnects and actions in a rolling
 * window (default 1 hour) and derives a 0-100 score (`100` = all recent
 * attempts succeeded, `100` when there is no data yet). The same window drives
 * `getFailureRate`, which the adaptive backoff uses to make a bot that is
 * failing harder wait longer between reconnects.
 */

export interface HealthScoreOptions {
  /** Outcome retention window, in milliseconds. Default 1 hour. */
  windowMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

interface HealthOutcome {
  success: boolean;
  at: number;
}

export class HealthScoreTracker {
  private outcomes: HealthOutcome[] = [];

  constructor(private readonly options: HealthScoreOptions = {}) {}

  private get windowMs(): number {
    return this.options.windowMs ?? 3_600_000;
  }

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.outcomes.length > 0 && this.outcomes[0].at <= cutoff) {
      this.outcomes.shift();
    }
  }

  recordSuccess(): void {
    this.record(true);
  }

  recordFailure(): void {
    this.record(false);
  }

  private record(success: boolean): void {
    const now = this.now;
    this.outcomes.push({ success, at: now });
    this.prune(now);
  }

  /** Total outcomes within the window (prunes expired entries first). */
  getTotal(): number {
    const now = this.now;
    this.prune(now);
    return this.outcomes.length;
  }

  /** Health score in `[0, 100]`; `100` when there is no data in the window. */
  getScore(): number {
    const now = this.now;
    this.prune(now);
    if (this.outcomes.length === 0) return 100;
    let successes = 0;
    for (const outcome of this.outcomes) {
      if (outcome.success) successes += 1;
    }
    return Math.round((successes / this.outcomes.length) * 100);
  }

  /** Failure rate in `[0, 1]` within the window; `0` when there is no data. */
  getFailureRate(): number {
    return 1 - this.getScore() / 100;
  }

  reset(): void {
    this.outcomes = [];
  }
}
