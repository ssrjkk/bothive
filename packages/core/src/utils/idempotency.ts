import { createHash, randomUUID } from 'node:crypto';
import type { PlatformEvent, PlatformEventInput } from '../types/events.js';
import { contractVersion } from '../contracts/contract-registry.js';

/**
 * Idempotency keys for platform events.
 *
 * A provider redelivers webhooks (Telegram retries an update until 2xx), a
 * worker failover replays the tail of a live connection, and the replay API
 * deliberately re-runs stored events. Without an idempotency key every one of
 * those paths double-emits: scripts fire twice, webhooks double-post, analytics
 * double-count. Every event therefore carries an `eventId` derived from the
 * platform's natural event id when one exists (so the duplicate maps to the
 * same key), and workers claim the key in a short-window store before fanning
 * the event out. Replays bypass the claim so an operator can force a re-run.
 */

/** A set-like store used to claim (deduplicate) idempotency keys. */
export interface DedupStore {
  /** Returns true when the key was NOT previously seen and is now claimed. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  /** Drops all tracked keys (test isolation / operator reset). */
  clear(): void;
}

/** In-memory fallback used when no Redis client is available. */
export class MemoryDedupStore implements DedupStore {
  private seen = new Map<string, number>();

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.seen.get(key);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.seen.set(key, now + ttlSeconds * 1000);
    if (this.seen.size > 100_000) this.prune(now);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }
}

/**
 * Redis-backed dedup store using `SET key 1 EX <ttl> NX` (atomic claim). When
 * Redis is unreachable it degrades to the in-memory fallback so a Redis outage
 * never causes duplicate emission across a single process (cross-process
 * dedup is lost during the outage, which is the accepted trade-off for keeping
 * the event pipeline alive).
 *
 * The client's `set` is typed loosely (`unknown`) because ioredis overloads it
 * heavily; we re-cast to the exact call shape at the call site.
 */
export interface DedupSetClient {
  status?: string;
  set?: unknown;
}

export class RedisDedupStore implements DedupStore {
  private readonly memory = new MemoryDedupStore();

  constructor(
    private readonly client: DedupSetClient | null | undefined,
    private readonly prefix: string,
  ) {}

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client) return this.memory.claim(key, ttlSeconds);
    const set = this.client.set as
      ((key: string, value: string, ...args: unknown[]) => Promise<unknown>) | undefined;
    if (typeof set !== 'function') return this.memory.claim(key, ttlSeconds);
    const fullKey = `${this.prefix}${key}`;
    try {
      const result = await set(fullKey, '1', 'EX', ttlSeconds, 'NX');
      // ioredis returns 'OK' on set, null on NX-skip; generic stubs return the
      // same truthiness, so "did we get a value" == "did we claim it".
      return result !== null && result !== undefined;
    } catch {
      return this.memory.claim(key, ttlSeconds);
    }
  }

  clear(): void {
    this.memory.clear();
  }
}

/**
 * Waits for a duration before dedup keys from the *same* source event id could
 * collide (e.g. Telegram may re-deliver an update seconds after the first).
 * Once the window passes, a genuinely new event with the same id is allowed.
 */
export const DEFAULT_DEDUP_TTL_SECONDS = 300;

/**
 * Derives a stable idempotency key for an event from the platform's natural
 * event id when one exists, falling back to a random UUID (no dedup, but the
 * key still makes persistence/replay idempotent).
 *
 * Natural ids are looked up across the common shapes the adapters emit
 * (`payload.id`, `payload.messageId`, `payload.update_id`, `payload.tweetId`,
 * plus a top-level `raw` fallback). Anything else — a message event whose
 * payload has no id — cannot be safely deduplicated (two identical texts are
 * not the same event), so it gets a unique key.
 */
export function deriveEventId(event: PlatformEventInput): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const natural =
    payload.id ??
    payload.messageId ??
    payload.update_id ??
    payload.tweetId ??
    (payload.data as { id?: unknown } | undefined)?.id ??
    (event.raw as { id?: unknown } | undefined)?.id;
  if (natural !== undefined && natural !== null && natural !== '') {
    return createHash('sha256')
      .update(`${event.platform}\u0000${event.botId}\u0000${event.type}\u0000${String(natural)}`)
      .digest('hex')
      .slice(0, 32);
  }
  return randomUUID();
}

/**
 * Whether the event carries a platform-natural id that makes it safe to
 * deduplicate. Only natural ids are claimed in the dedup store: a UUID-derived
 * key is unique by construction, so storing it would just burn Redis memory.
 */
export function hasNaturalEventId(event: PlatformEventInput): boolean {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const natural =
    payload.id ??
    payload.messageId ??
    payload.update_id ??
    payload.tweetId ??
    (payload.data as { id?: unknown } | undefined)?.id ??
    (event.raw as { id?: unknown } | undefined)?.id;
  return natural !== undefined && natural !== null && natural !== '';
}

/** Stamps the contract version and idempotency key onto a raw adapter event. */
export function enrichPlatformEvent(event: PlatformEventInput): PlatformEvent {
  return {
    ...event,
    v: contractVersion(event.platform, event.type),
    eventId: deriveEventId(event),
  };
}
