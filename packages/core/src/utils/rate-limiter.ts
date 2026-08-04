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

  async waitIfNeeded(key: string): Promise<void> {
    while (!this.check(key)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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
