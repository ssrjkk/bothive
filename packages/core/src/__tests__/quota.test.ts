import { describe, it, expect } from 'vitest';
import { checkQuota, getQuotaLimits } from '../tenancy/quota.js';
import type { QuotaLimits } from '../tenancy/quota.js';

describe('quota', () => {
  it('returns the default limits from the environment', () => {
    const limits = getQuotaLimits();
    expect(limits.maxAccounts).toBeGreaterThan(0);
    expect(limits.maxBots).toBeGreaterThan(0);
    expect(limits.maxWebhooks).toBeGreaterThan(0);
  });

  it('allows creation while under the limit', () => {
    const usage = { accounts: 1, bots: 5, webhooks: 2 };
    const limits: QuotaLimits = { maxAccounts: 20, maxBots: 50, maxWebhooks: 30 };
    expect(checkQuota(usage, 'accounts', limits)).toEqual({ ok: true });
    expect(checkQuota(usage, 'bots', limits)).toEqual({ ok: true });
    expect(checkQuota(usage, 'webhooks', limits)).toEqual({ ok: true });
  });

  it('allows creating the very last slot exactly at the limit', () => {
    const usage = { accounts: 19, bots: 0, webhooks: 0 };
    const limits: QuotaLimits = { maxAccounts: 20, maxBots: 50, maxWebhooks: 30 };
    expect(checkQuota(usage, 'accounts', limits)).toEqual({ ok: true });
  });

  it('rejects when at the limit with a QUOTA_EXCEEDED payload', () => {
    const usage = { accounts: 20, bots: 0, webhooks: 0 };
    const limits: QuotaLimits = { maxAccounts: 20, maxBots: 50, maxWebhooks: 30 };
    const result = checkQuota(usage, 'accounts', limits);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('QUOTA_EXCEEDED');
      expect(result.error.details).toMatchObject({ resource: 'accounts', current: 20, limit: 20 });
    }
  });

  it('maps each resource to its own limit', () => {
    const usage = { accounts: 0, bots: 50, webhooks: 0 };
    const limits: QuotaLimits = { maxAccounts: 20, maxBots: 10, maxWebhooks: 30 };
    // bots is at 50 > maxBots 10, but accounts/webhooks are fine.
    expect(checkQuota(usage, 'bots', limits).ok).toBe(false);
    expect(checkQuota(usage, 'accounts', limits).ok).toBe(true);
    expect(checkQuota(usage, 'webhooks', limits).ok).toBe(true);
  });
});
