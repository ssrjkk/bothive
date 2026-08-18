export class RateLimiter {
  private timestamps: Map<string, number[]> = new Map();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.timestamps.get(key);
    if (!timestamps) {
      timestamps = [];
    } else {
      timestamps = timestamps.filter((t) => t > windowStart);
    }

    if (timestamps.length === 0) {
      this.timestamps.delete(key);
    } else {
      this.timestamps.set(key, timestamps);
    }

    if (timestamps.length >= this.maxRequests) {
      return false;
    }

    timestamps.push(now);
    this.timestamps.set(key, timestamps);

    if (this.timestamps.size > 10_000) this.pruneExpired();

    return true;
  }

  /**
   * Waits until `check` would accept a request, then returns. Instead of
   * polling every 100ms it sleeps exactly until the oldest in-window request
   * expires, so a rejected key never busy-spins and a `maxRequests <= 0` or
   * zero-width window can never loop forever (it rejects immediately).
   */
  async waitIfNeeded(key: string): Promise<void> {
    if (this.maxRequests <= 0 || this.windowMs <= 0) {
      throw new Error('RateLimiter: maxRequests and windowMs must be positive');
    }
    for (;;) {
      const delay = this.waitDelay(key);
      if (delay === 0) return;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /** Milliseconds until the next slot in the window frees up (0 = available). */
  private waitDelay(key: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.timestamps.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length < this.maxRequests) return 0;
    const oldest = timestamps[0];
    if (oldest === undefined) return 0;
    return Math.max(1, oldest - windowStart);
  }

  getRemaining(key: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.timestamps.get(key) ?? []).filter((t) => t > windowStart);
    return Math.max(0, this.maxRequests - timestamps.length);
  }

  clear(): void {
    this.timestamps.clear();
  }

  private pruneExpired(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.timestamps) {
      const alive = timestamps.filter((t) => t > windowStart);
      if (alive.length === 0) this.timestamps.delete(key);
      else this.timestamps.set(key, alive);
    }
  }
}
