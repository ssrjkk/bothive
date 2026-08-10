/**
 * Rolling window of BullMQ job wait times (ms -> enqueue to active), used to
 * derive p50/p95/p99 queue-delay percentiles. The worker samples every
 * `active` event and the API exposes the latest percentiles as gauges, so a
 * build-up that a plain waiting-depth counter misses (jobs sitting just under a
 * worker's concurrency, or workers stuck on a slow platform call) shows up as
 * growing p95/p99 wait time.
 *
 * The window is TIME-based, not just sample-count-based: samples older than
 * `windowMs` are dropped when percentiles are computed, so a burst from an hour
 * ago cannot keep p95 high after the queue drained.
 */
export interface WaitTimeTrackerOptions {
  /** Max samples kept in the ring buffer; oldest are evicted once full. */
  capacity?: number;
  /** Only samples newer than this are included in percentiles (ms). */
  windowMs?: number;
}

const DEFAULT_CAPACITY = 1000;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

export class WaitTimeTracker {
  private readonly samples: { ts: number; ms: number }[] = [];
  private readonly capacity: number;
  private readonly windowMs: number;
  private next = 0;
  private size = 0;

  constructor(options: WaitTimeTrackerOptions = {}) {
    // Guard against a misconfigured (zero/negative) capacity: the ring buffer
    // must always hold at least one slot or record() would clobber itself.
    this.capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_CAPACITY));
    this.windowMs = Math.max(1, Math.floor(options.windowMs ?? DEFAULT_WINDOW_MS));
  }

  record(waitMs: number, ts: number = Date.now()): void {
    if (!Number.isFinite(waitMs) || waitMs < 0) return;
    this.samples[this.next] = { ts, ms: waitMs };
    this.next = (this.next + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  get sizeCount(): number {
    return this.size;
  }

  /** Returns the p50/p95/p99 in seconds over samples newer than the window (0 when none). */
  percentiles(): { p50: number; p95: number; p99: number } {
    const cutoff = Date.now() - this.windowMs;
    const fresh: number[] = [];
    for (let i = 0; i < this.size; i += 1) {
      const sample = this.samples[i];
      if (sample && sample.ts >= cutoff) fresh.push(sample.ms);
    }
    if (fresh.length === 0) return { p50: 0, p95: 0, p99: 0 };
    fresh.sort((a, b) => a - b);
    const at = (q: number): number => {
      const index = Math.min(fresh.length - 1, Math.max(0, Math.ceil(q * fresh.length) - 1));
      return fresh[index] / 1000;
    };
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
  }
}
