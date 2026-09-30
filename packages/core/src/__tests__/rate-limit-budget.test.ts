import { describe, it, expect } from 'vitest';
import {
  isRateLimitBudget,
  isRateLimitBudgets,
  resolveActionBudget,
  parseRateLimitBudgets,
  serializeRateLimitBudgets,
  DEFAULT_RATE_LIMIT_BUDGET,
} from '../rate-limit/budget.js';

const VALID_BUDGETS = {
  default: { maxRequests: 30, windowMs: 60_000 },
  overrides: {
    tweet: { maxRequests: 17, windowMs: 900_000 },
    say: { maxRequests: 20, windowMs: 30_000 },
  },
};

describe('isRateLimitBudget', () => {
  it('accepts a valid budget', () => {
    expect(isRateLimitBudget({ maxRequests: 30, windowMs: 60_000 })).toBe(true);
  });

  it('rejects invalid budgets', () => {
    expect(isRateLimitBudget(null)).toBe(false);
    expect(isRateLimitBudget({ maxRequests: 0, windowMs: 60_000 })).toBe(false);
    expect(isRateLimitBudget({ maxRequests: 30, windowMs: 0 })).toBe(false);
    expect(isRateLimitBudget({ maxRequests: 1.5, windowMs: 60_000 })).toBe(false);
    expect(isRateLimitBudget({ maxRequests: 30 })).toBe(false);
  });
});

describe('isRateLimitBudgets', () => {
  it('accepts a complete budget set', () => {
    expect(isRateLimitBudgets(VALID_BUDGETS)).toBe(true);
  });

  it('accepts overrides without an explicit default', () => {
    expect(isRateLimitBudgets({ default: VALID_BUDGETS.default, overrides: {} })).toBe(true);
  });

  it('rejects malformed override values', () => {
    expect(
      isRateLimitBudgets({
        default: VALID_BUDGETS.default,
        overrides: { tweet: { maxRequests: -1, windowMs: 1000 } },
      }),
    ).toBe(false);
  });
});

describe('resolveActionBudget', () => {
  it('picks the override for a known action type', () => {
    expect(resolveActionBudget(VALID_BUDGETS, 'tweet')).toEqual({
      maxRequests: 17,
      windowMs: 900_000,
    });
  });

  it('falls back to the default budget', () => {
    expect(resolveActionBudget(VALID_BUDGETS, 'sendPhoto')).toEqual(VALID_BUDGETS.default);
  });

  it('falls back to the provided fallback when no budgets are set', () => {
    expect(resolveActionBudget(undefined, 'tweet')).toEqual(DEFAULT_RATE_LIMIT_BUDGET);
    const custom = { maxRequests: 5, windowMs: 10_000 };
    expect(resolveActionBudget(undefined, 'tweet', custom)).toEqual(custom);
  });
});

describe('parseRateLimitBudgets', () => {
  it('parses a valid JSON string', () => {
    expect(parseRateLimitBudgets(JSON.stringify(VALID_BUDGETS))).toEqual(VALID_BUDGETS);
  });

  it('returns undefined for empty/absent input', () => {
    expect(parseRateLimitBudgets(undefined)).toBeUndefined();
    expect(parseRateLimitBudgets('')).toBeUndefined();
    expect(parseRateLimitBudgets('   ')).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseRateLimitBudgets('{not json')).toBeUndefined();
  });

  it('returns undefined for valid JSON with an invalid shape', () => {
    expect(parseRateLimitBudgets('{"default": {"maxRequests": 0, "windowMs": 1}}')).toBeUndefined();
  });
});

describe('serializeRateLimitBudgets', () => {
  it('round-trips through parse', () => {
    const raw = serializeRateLimitBudgets(VALID_BUDGETS);
    expect(parseRateLimitBudgets(raw)).toEqual(VALID_BUDGETS);
  });
});
