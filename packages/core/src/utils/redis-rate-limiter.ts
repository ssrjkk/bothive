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
      count = await this.incrementAtomic(key);
    } catch {
      // Redis unreachable: degrade to the in-memory limiter instead of failing
      // every request while the connection is down.
      return this.memory.check(scope);
    }
    return count <= this.maxRequests;
  }

  /**
   * Increments the counter and (re)arms the TTL in a single atomic step, so a
   * key can never be orphaned without an expiry (which would permanently block
   * the scope or leak Redis memory). Falls back to INCR + PEXPIRE for clients
   * that do not expose `eval` (ioredis's `eval` is overloaded, so it is
   * feature-detected through a local widening cast).
   */
  private async incrementAtomic(key: string): Promise<number> {
    const client = this.client as RateLimitClient & {
      eval?: (script: string, numKeys: number, ...args: (string | number)[]) => Promise<unknown>;
    };
    if (typeof client.eval === 'function') {
      return (await client.eval(
        'local c = redis.call("INCR", KEYS[1]);' +
          'if c == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end;' +
          'return c',
        1,
        key,
        this.windowMs,
      )) as number;
    }
    const count = await client.incr!(key);
    try {
      await client.pexpire!(key, this.windowMs);
    } catch {
      // best-effort: a failed expire still allows the counter to work
    }
    return count;
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
