/**
 * Per-action-type rate limit budgets.
 *
 * The global outbound limiter treats every outbound call alike, so a bot that
 * only ever tweets can be blocked by a noisy `sendMessage` loop on the same
 * worker — and vice versa a single action type can silently exhaust the whole
 * shared window. Budgeting splits the outbound allowance by action type (each
 * with its own window and cap) so a burst in one endpoint never starves
 * another, and lets an operator weight priority actions higher.
 *
 * The shape mirrors what a bot's `config.rateLimitBudgets` can carry:
 *
 *   {
 *     "default":  { "maxRequests": 30, "windowMs": 60000 },
 *     "overrides": {
 *       "tweet":     { "maxRequests": 17, "windowMs": 900000 },
 *       "sendMessage": { "maxRequests": 20, "windowMs": 60000 }
 *     }
 *   }
 */

export interface RateLimitBudget {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitBudgets {
  default: RateLimitBudget;
  /** Action-type-specific budgets. An override also REPLACES the default
   * allowance for that action type rather than consuming from both. */
  overrides: Record<string, RateLimitBudget>;
}

export const DEFAULT_RATE_LIMIT_BUDGET: RateLimitBudget = {
  maxRequests: 30,
  windowMs: 60_000,
};

export function isRateLimitBudget(value: unknown): value is RateLimitBudget {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.maxRequests === 'number' &&
    Number.isInteger(v.maxRequests) &&
    v.maxRequests > 0 &&
    typeof v.windowMs === 'number' &&
    Number.isInteger(v.windowMs) &&
    v.windowMs > 0
  );
}

export function isRateLimitBudgets(value: unknown): value is RateLimitBudgets {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!isRateLimitBudget(v.default)) return false;
  if (v.overrides !== undefined && (typeof v.overrides !== 'object' || v.overrides === null)) {
    return false;
  }
  for (const budget of Object.values((v.overrides ?? {}) as Record<string, unknown>)) {
    if (!isRateLimitBudget(budget)) return false;
  }
  return true;
}

/** Picks the budget that governs an action type, falling back to defaults. */
export function resolveActionBudget(
  budgets: RateLimitBudgets | undefined,
  actionType: string,
  fallback: RateLimitBudget = DEFAULT_RATE_LIMIT_BUDGET,
): RateLimitBudget {
  const base = budgets?.default ?? fallback;
  const override = budgets?.overrides?.[actionType];
  return override ?? base;
}

/**
 * Parses the `RATE_LIMIT_BUDGETS` JSON environment variable. Invalid/partial
 * values fall back to defaults instead of throwing, so a typo in a deployment
 * config degrades to the global budget rather than killing the worker.
 */
export function parseRateLimitBudgets(raw: string | undefined): RateLimitBudgets | undefined {
  if (!raw || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRateLimitBudgets(parsed)) return undefined;
  return parsed;
}

/**
 * Canonical JSON serialization of the parsed budgets (for tests / validation /
 * round-tripping config through the API).
 */
export function serializeRateLimitBudgets(budgets: RateLimitBudgets): string {
  return JSON.stringify(budgets);
}
