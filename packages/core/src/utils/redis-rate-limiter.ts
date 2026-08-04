import { RateLimiter } from './rate-limiter.js';

export interface RateLimitClient {
  incr?: (key: string) => Promise<number>;
  pexpire?: (key: string, ms: number) => Promise<unknown>;
  get?: (key: string) => Promise<string | number | null>;
}

/**
 * Redis-backed sliding-window counter limiter. Falls back to an in-memory
 * limiter when no Redis client (or a stub without incr/pexpire) is provided,
 * so it is safe to use in tests and when Redis is unavailable.
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
    const count = await this.client!.incr!(key);
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
    const raw = await this.client!.get!(key);
    const count = Number(raw) || 0;
    return Math.max(0, this.maxRequests - count);
  }
}
