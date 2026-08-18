/**
 * Adaptive reconnect backoff.
 *
 * The old linear table (`[5s, 15s, 30s, 60s, 120s]`) had two problems: it was
 * fixed regardless of how badly a bot was failing, and it had no jitter, so a
 * fleet that lost its platform simultaneously would reconnect in perfect
 * lock-step (a thundering herd on every platform API).
 *
 * This is exponential with per-attempt jitter, scaled by the recent failure
 * rate: a bot that is failing half its actions backs off twice as hard. The
 * delay is capped so a platform outage never escalates to multi-hour waits.
 */

export const DEFAULT_BACKOFF_MAX_MS = 300_000; // 5 minutes

export interface BackoffOptions {
  /** Base delay for the first retry (attempt 0), in milliseconds. Default 1000. */
  baseDelayMs?: number;
  /** Fraction (0..1) of the base delay added as random jitter. Default 0.1. */
  jitterRatio?: number;
  /** Ceiling for the returned delay, in milliseconds. Default 5 minutes. */
  maxDelayMs?: number;
  /** Inject a deterministic RNG for tests. */
  random?: () => number;
}

/**
 * Computes the delay before retry `attempt` (0-based) given a recent failure
 * rate in `[0, 1]`. The delay is `base * 2^attempt * (1 + failureRate)` plus a
 * random jitter, capped at `maxDelayMs`.
 */
export function calculateBackoff(
  attempt: number,
  failureRate = 0,
  options: BackoffOptions = {},
): number {
  const {
    baseDelayMs = 1000,
    jitterRatio = 0.1,
    maxDelayMs = DEFAULT_BACKOFF_MAX_MS,
    random = Math.random,
  } = options;

  const attempts = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const rate = Number.isFinite(failureRate) ? Math.max(0, Math.min(1, failureRate)) : 0;
  const base = Number.isFinite(baseDelayMs) && baseDelayMs > 0 ? baseDelayMs : 1000;
  const jitterRatioClamped = Number.isFinite(jitterRatio)
    ? Math.max(0, Math.min(1, jitterRatio))
    : 0.1;
  const cap = Number.isFinite(maxDelayMs) && maxDelayMs > 0 ? maxDelayMs : DEFAULT_BACKOFF_MAX_MS;

  const baseDelay = base * 2 ** attempts;
  const jitter = random() * baseDelay * jitterRatioClamped;

  return Math.min(baseDelay * (1 + rate) + jitter, cap);
}
