/**
 * Rolling window of BullMQ job wait times (ms -> enqueue to active), used to
 * derive p50/p95/p99 queue-delay percentiles. The worker samples every
 * `active` event and the API exposes the latest percentiles as gauges, so a
 * build-up that a plain waiting-depth counter misses (jobs sitting just under a
 * worker's concurrency, or workers stuck on a slow platform call) shows up as
 * growing p95/p99 wait time.
 */
export class WaitTimeTracker {
  private readonly samples: number[] = [];
  private readonly capacity: number;
  private next = 0;
  private size = 0;

  constructor(capacity = 500) {
    this.capacity = capacity;
  }

  record(waitMs: number): void {
    if (!Number.isFinite(waitMs) || waitMs < 0) return;
    this.samples[this.next] = waitMs;
    this.next = (this.next + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  get sizeCount(): number {
    return this.size;
  }

  /** Returns the p50/p95/p99 in seconds (0 when no samples yet). */
  percentiles(): { p50: number; p95: number; p99: number } {
    if (this.size === 0) return { p50: 0, p95: 0, p99: 0 };
    const sorted = this.samples.slice(0, this.size).sort((a, b) => a - b);
    const at = (q: number): number => {
      const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
      return sorted[index] / 1000;
    };
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
  }
}
