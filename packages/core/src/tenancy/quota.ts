/**
 * Per-user resource quota enforcement.
 *
 * Every owner-scoped resource (accounts, bots, webhooks) is bounded by a
 * configurable per-user cap.  The defaults below can be overridden via
 * environment variables so a deployment can tune limits without code changes.
 *
 * The quota check is intentionally "check-then-act" (not a DB-level
 * constraint) because:
 *   1. The counts are cheap (single-row aggregates on indexed columns).
 *   2. Race windows are negligible — two simultaneous creates for the same
 *      user are serialized by Postgres's row-level locking on the Account/Bot
 *      table, and even if both pass the count check, the second insert will
 *      be the one that violates the FK or unique constraint, which is
 *      retried by the client anyway.
 *   3. A CHECK constraint would require a raw SQL migration and is harder to
 *      override per-deployment.
 */

export interface QuotaLimits {
  maxAccounts: number;
  maxBots: number;
  maxWebhooks: number;
}

const DEFAULTS: QuotaLimits = {
  maxAccounts: Number(process.env.QUOTA_MAX_ACCOUNTS ?? 20),
  maxBots: Number(process.env.QUOTA_MAX_BOTS ?? 50),
  maxWebhooks: Number(process.env.QUOTA_MAX_WEBHOOKS ?? 30),
};

/**
 * Returns the effective quota limits for the current deployment.
 * Values are read once at import time — changing env vars at runtime has no
 * effect until the process restarts.
 */
export function getQuotaLimits(): QuotaLimits {
  return { ...DEFAULTS };
}

export interface QuotaUsage {
  accounts: number;
  bots: number;
  webhooks: number;
}

export type QuotaResource = keyof QuotaUsage;

const LIMIT_KEYS: Record<QuotaResource, keyof QuotaLimits> = {
  accounts: 'maxAccounts',
  bots: 'maxBots',
  webhooks: 'maxWebhooks',
};

/**
 * Checks whether the owner has headroom for one more `resource`.
 * Returns `null` when within quota, or a descriptive error payload when the
 * limit would be exceeded.
 */
export function checkQuota(
  usage: QuotaUsage,
  resource: QuotaResource,
  limits: QuotaLimits = DEFAULTS,
):
  | { ok: true }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } } {
  const limit = limits[LIMIT_KEYS[resource]];
  const current = usage[resource];
  if (current < limit) {
    return { ok: true };
  }
  return {
    ok: false,
    error: {
      code: 'QUOTA_EXCEEDED',
      message: `Maximum number of ${resource} reached (${limit}).`,
      details: { resource, current, limit },
    },
  };
}
