import { describe, it, expect } from 'vitest';
import {
  deriveEventId,
  hasNaturalEventId,
  enrichPlatformEvent,
  MemoryDedupStore,
  RedisDedupStore,
  DEFAULT_DEDUP_TTL_SECONDS,
} from '../utils/idempotency.js';
import type { PlatformEventInput } from '../types/events.js';

function baseEvent(overrides: Partial<PlatformEventInput> = {}): PlatformEventInput {
  return {
    botId: 'bot-1',
    platform: 'twitch',
    type: 'message',
    payload: { text: 'hello' },
    timestamp: new Date(),
    ...overrides,
  };
}

describe('deriveEventId', () => {
  it('derives a stable key from a natural platform id', () => {
    const a = deriveEventId(baseEvent({ payload: { id: 'msg-42', text: 'hi' } }));
    const b = deriveEventId(baseEvent({ payload: { id: 'msg-42', text: 'hi' } }));
    const different = deriveEventId(baseEvent({ payload: { id: 'msg-43', text: 'hi' } }));
    expect(a).toBe(b);
    expect(a).not.toBe(different);
  });

  it('uses messageId / update_id / tweetId as natural ids', () => {
    expect(deriveEventId(baseEvent({ payload: { messageId: 7 } }))).toBe(
      deriveEventId(baseEvent({ payload: { messageId: 7 } })),
    );
    expect(deriveEventId(baseEvent({ platform: 'telegram', payload: { update_id: 99 } }))).toBe(
      deriveEventId(baseEvent({ platform: 'telegram', payload: { update_id: 99 } })),
    );
    expect(deriveEventId(baseEvent({ platform: 'twitter', payload: { tweetId: 't1' } }))).toBe(
      deriveEventId(baseEvent({ platform: 'twitter', payload: { tweetId: 't1' } })),
    );
  });

  it('returns a fresh UUID when there is no natural id', () => {
    const a = deriveEventId(baseEvent());
    const b = deriveEventId(baseEvent());
    expect(a).not.toBe(b);
    expect(a).toHaveLength(36);
  });
});

describe('hasNaturalEventId', () => {
  it('detects natural ids and rejects id-less events', () => {
    expect(hasNaturalEventId(baseEvent({ payload: { id: 'x' } }))).toBe(true);
    expect(hasNaturalEventId(baseEvent())).toBe(false);
  });
});

describe('enrichPlatformEvent', () => {
  it('stamps contract version and eventId', () => {
    const enriched = enrichPlatformEvent(baseEvent({ payload: { id: 'm1' } }));
    expect(enriched.v).toBe(1);
    expect(enriched.eventId).toHaveLength(32);
    expect(enriched.eventId).toBe(deriveEventId(baseEvent({ payload: { id: 'm1' } })));
  });
});

describe('MemoryDedupStore', () => {
  it('claims a key once per window', async () => {
    const store = new MemoryDedupStore();
    expect(await store.claim('k', 60)).toBe(true);
    expect(await store.claim('k', 60)).toBe(false);
  });

  it('releases the key after the ttl elapses', async () => {
    const store = new MemoryDedupStore();
    await store.claim('k', 0);
    await new Promise((r) => setTimeout(r, 10));
    expect(await store.claim('k', 0)).toBe(true);
  });

  it('distinct keys are independent', async () => {
    const store = new MemoryDedupStore();
    await store.claim('a', 60);
    expect(await store.claim('b', 60)).toBe(true);
  });
});

describe('RedisDedupStore', () => {
  it('falls back to memory when no client is provided', async () => {
    const store = new RedisDedupStore(null, 'p:');
    expect(await store.claim('k', 60)).toBe(true);
    expect(await store.claim('k', 60)).toBe(false);
  });

  it('uses the client set NX semantics when available', async () => {
    const claimed = new Set<string>();
    const calls: unknown[][] = [];
    const client = {
      set: async (key: string, value: string, ...args: unknown[]) => {
        calls.push([key, value, ...args]);
        if (claimed.has(key)) return null;
        claimed.add(key);
        return 'OK';
      },
    };
    const store = new RedisDedupStore(client, 'bothive:event:dedup:');
    expect(await store.claim('k', 300)).toBe(true);
    expect(await store.claim('k', 300)).toBe(false);
    expect(calls[0]).toEqual(['bothive:event:dedup:k', '1', 'EX', 300, 'NX']);
  });

  it('degrades to memory when the client throws', async () => {
    const store = new RedisDedupStore({ set: async () => Promise.reject(new Error('down')) }, 'p:');
    expect(await store.claim('k', 60)).toBe(true);
  });
});

describe('DEFAULT_DEDUP_TTL_SECONDS', () => {
  it('is a positive window', () => {
    expect(DEFAULT_DEDUP_TTL_SECONDS).toBeGreaterThan(0);
  });
});
