/**
 * Per-bot connection circuit breaker.
 *
 * A bot whose connection keeps failing used to be reconnected on an endless
 * loop, hammering the platform provider every few seconds even when the account
 * was banned, the platform was down, or the token was revoked. The breaker
 * stops that:
 *
 *   - `closed`: normal operation. After `failureThreshold` consecutive
 *     failures it trips to `open`.
 *   - `open`: attempts are rejected immediately for `resetTimeoutMs`, so the
 *     provider is not hammered. After the cooldown the breaker moves to
 *     `half_open` on the next attempt.
 *   - `half_open`: a limited number of probe attempts are let through; if
 *     `successThreshold` of them succeed the breaker closes, otherwise it
 *     reopens with a fresh cooldown.
 *
 * The clock is injectable (`now`), which makes the cooldown testable without
 * waiting real time.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker. Default 5. */
  failureThreshold?: number;
  /** Consecutive half-open successes that close the breaker. Default 2. */
  successThreshold?: number;
  /** Cooldown before a probe is allowed, in milliseconds. Default 60s. */
  resetTimeoutMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private halfOpenSuccesses = 0;
  private probesRemaining = 0;

  constructor(private readonly options: CircuitBreakerOptions = {}) {}

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  private get failureThreshold(): number {
    return this.options.failureThreshold ?? 5;
  }

  private get successThreshold(): number {
    return this.options.successThreshold ?? 2;
  }

  private get resetTimeoutMs(): number {
    return this.options.resetTimeoutMs ?? 60_000;
  }

  /**
   * Lazily moves an expired `open` breaker to `half_open`, allowing probes.
   * Called by `getState`/`canAttempt` so the cooldown only needs wall-clock
   * time to elapse — no timer bookkeeping required.
   */
  private tryHalfOpen(): void {
    if (this.state !== 'open') return;
    if (this.now - this.openedAt < this.resetTimeoutMs) return;
    this.state = 'half_open';
    this.halfOpenSuccesses = 0;
    this.probesRemaining = this.successThreshold;
  }

  getState(): CircuitState {
    this.tryHalfOpen();
    return this.state;
  }

  /**
   * Whether a new attempt may be made right now. In `half_open` this consumes
   * one probe, so at most `successThreshold` concurrent attempts are allowed.
   */
  canAttempt(): boolean {
    this.tryHalfOpen();
    if (this.state === 'open') return false;
    if (this.state === 'half_open') {
      if (this.probesRemaining <= 0) {
        // Every probe was consumed without reaching successThreshold (e.g. an
        // attempt was abandoned without recordSuccess/recordFailure). Reopen so
        // the breaker never stays wedged in half_open with canAttempt()=false.
        this.open();
        return false;
      }
      this.probesRemaining -= 1;
      return true;
    }
    return true;
  }

  recordSuccess(): void {
    if (this.state === 'open') return; // stay open until the cooldown elapses
    if (this.state === 'half_open') {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.successThreshold) this.close();
      return;
    }
    // closed: a success breaks the failure streak and un-arms the breaker
    this.failures = 0;
  }

  recordFailure(): void {
    if (this.state === 'half_open') {
      // a failed probe reopens immediately with a fresh cooldown
      this.open();
      return;
    }
    if (this.state === 'open') return; // do not extend the cooldown by re-failing
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.open();
  }

  /** Force the breaker back to `closed` (e.g. after giving up / manual reset). */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.halfOpenSuccesses = 0;
    this.probesRemaining = 0;
  }

  /** Milliseconds until the next probe is allowed; 0 when not `open`. */
  remainingCooldownMs(): number {
    this.tryHalfOpen();
    if (this.state !== 'open') return 0;
    return Math.max(0, this.resetTimeoutMs - (this.now - this.openedAt));
  }

  private open(): void {
    this.state = 'open';
    this.openedAt = this.now;
    this.halfOpenSuccesses = 0;
    this.probesRemaining = 0;
  }

  private close(): void {
    this.state = 'closed';
    this.failures = 0;
    this.halfOpenSuccesses = 0;
    this.probesRemaining = 0;
  }
}
