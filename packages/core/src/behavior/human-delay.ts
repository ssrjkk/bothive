/**
 * Human-like delay generator.
 *
 * Replaces fixed `setTimeout` calls with non-linear, statistically plausible
 * delays that mimic real user behavior.  Three distributions are provided:
 *
 *  - **gaussian**: symmetric bell-curve around a mean.  Good for typing speed,
 *    inter-message gaps, and any delay that clusters around a central value.
 *
 *  - **logNormal**: right-skewed — most values are short, a few are long.
 *    Perfect for "time between actions" where quick repeats are common but
 *    occasional long pauses happen naturally.
 *
 *  - **uniform**: equal probability across a range.  Use when you want raw
 *    randomness without clustering (e.g. jitter on top of another distribution).
 *
 * All functions return milliseconds.
 */

/* -------------------------------------------------------------------------- */
/*  Internal helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Box-Muller transform: produces a standard normal (μ=0, σ=1) variate. */
function boxMuller(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export interface DelayOptions {
  /** Inject a deterministic RNG for tests.  Defaults to `Math.random`. */
  random?: () => number;
}

/**
 * Gaussian (normal) delay centered on `meanMs` with standard deviation
 * `stdMs`.  Values are clamped to `[minMs, maxMs]` so outliers never cause
 * absurdly long waits or negative delays.
 *
 * @example
 *   // "Typing" delay: average 80ms per character ± 20ms
 *   const charDelay = gaussian(80, 20, { minMs: 40, maxMs: 150 });
 */
export function gaussian(
  meanMs: number,
  stdMs: number,
  bounds: { minMs?: number; maxMs?: number } = {},
  options: DelayOptions = {},
): number {
  const { random = Math.random } = options;
  const min = bounds.minMs ?? 0;
  const max = bounds.maxMs ?? Infinity;
  const raw = meanMs + boxMuller(random) * stdMs;
  return Math.max(min, Math.min(max, raw));
}

/**
 * Log-normal delay.  The parameters are the mean and standard deviation of the
 * *underlying* normal distribution (μ, σ), NOT of the output.
 *
 * A common choice: `μ = ln(targetMedian)`, `σ ≈ 0.5` gives a moderately
 * right-skewed distribution.
 *
 * @example
 *   // "Pause between messages": median ~3s, occasional 8-12s pauses
 *   const pause = logNormal(Math.log(3000), 0.5, { minMs: 1000, maxMs: 15_000 });
 */
export function logNormal(
  mu: number,
  sigma: number,
  bounds: { minMs?: number; maxMs?: number } = {},
  options: DelayOptions = {},
): number {
  const { random = Math.random } = options;
  const min = bounds.minMs ?? 0;
  const max = bounds.maxMs ?? Infinity;
  const raw = Math.exp(mu + boxMuller(random) * sigma);
  return Math.max(min, Math.min(max, raw));
}

/**
 * Uniform random delay between `minMs` and `maxMs` (inclusive).
 */
export function uniform(minMs: number, maxMs: number, options: DelayOptions = {}): number {
  const { random = Math.random } = options;
  return minMs + random() * (maxMs - minMs);
}

/* -------------------------------------------------------------------------- */
/*  High-level presets                                                        */
/* -------------------------------------------------------------------------- */

/** Typing delay per character (ms). Imitates a human typing on a keyboard. */
export function typingDelay(options: DelayOptions = {}): number {
  return gaussian(75, 25, { minMs: 30, maxMs: 160 }, options);
}

/** Pause between two consecutive messages (ms). */
export function messageGap(options: DelayOptions = {}): number {
  return logNormal(Math.log(3500), 0.6, { minMs: 800, maxMs: 20_000 }, options);
}

/** Delay before clicking a UI element after it becomes visible (ms). */
export function clickDelay(options: DelayOptions = {}): number {
  return gaussian(350, 120, { minMs: 100, maxMs: 900 }, options);
}

/** Delay before sending a "reaction" action (ms). Slightly longer than a click. */
export function reactionDelay(options: DelayOptions = {}): number {
  return gaussian(1200, 400, { minMs: 400, maxMs: 4000 }, options);
}

/** Simulates a "thinking" pause before composing a reply (ms). */
export function thinkingPause(options: DelayOptions = {}): number {
  return logNormal(Math.log(5000), 0.7, { minMs: 1500, maxMs: 30_000 }, options);
}

/** Scroll delay between page scrolls (ms). */
export function scrollDelay(options: DelayOptions = {}): number {
  return gaussian(600, 200, { minMs: 200, maxMs: 1500 }, options);
}
