import { RateLimiter } from './rate-limiter.js';

export interface RateLimitClient {
  incr?: (key: string) => Promise<number>;
  pexpire?: (key: string, ms: number) => Promise<unknown>;
  get?: (key: string) => Promise<string | number | null>;
}

/**
 * Redis-backed sliding-window counter limiter. Falls back to an in-memory
 * limiter when no Redis client (or a stub without incr/pexpire) is provided
 * AND when a configured client errors (Redis down/unreachable), so rate
 * limiting degrades to a per-instance budget instead of failing every request
 * while the connection is out.
 */
export class RedisRateLimiter {
  private readonly memory: RateLimiter;

  constructor(
    private readonly client: RateLimitClient | null | undefined,
    private readonly prefix: string,
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {
    this.memory = new RateLimiter(maxRequests, windowMs);
  }

  private get canUseRedis(): boolean {
    return (
      this.client != null &&
      typeof this.client.incr === 'function' &&
      typeof this.client.pexpire === 'function'
    );
  }

  async check(scope: string): Promise<boolean> {
    if (!this.canUseRedis) return this.memory.check(scope);

    const key = `${this.prefix}:${scope}`;
    let count: number;
    try {
      count = await this.client!.incr!(key);
    } catch {
      // Redis unreachable: degrade to the in-memory limiter instead of failing
      // every request while the connection is down.
      return this.memory.check(scope);
    }
    // Always refresh the TTL so a key can never be orphaned without an expiry
    // (which would permanently block the scope or leak Redis memory).
    try {
      await this.client!.pexpire!(key, this.windowMs);
    } catch {
      // best-effort: a failed expire still allows the counter to work
    }
    return count <= this.maxRequests;
  }

  async getRemaining(scope: string): Promise<number> {
    if (!this.canUseRedis) return this.memory.getRemaining(scope);

    if (typeof this.client!.get !== 'function') return this.memory.getRemaining(scope);

    const key = `${this.prefix}:${scope}`;
    let raw: string | number | null;
    try {
      raw = await this.client!.get!(key);
    } catch {
      // Redis unreachable: the in-memory window is the best estimate available.
      return this.memory.getRemaining(scope);
    }
    const count = Number(raw) || 0;
    return Math.max(0, this.maxRequests - count);
  }
}
