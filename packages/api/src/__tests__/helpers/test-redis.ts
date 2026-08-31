import { Redis } from 'ioredis';

// A single shared ioredis client bound to the test Redis (REDIS_URL is set in
// vitest.setup.ts). Used by tests to seed and clean up keys that the module
// under test reads/writes, so the tests exercise the REAL Redis instead of an
// in-memory fake. The test Redis is a dedicated container, so flushing the
// `bothive:*` namespace between tests is safe and keeps state deterministic.
export const testRedis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: 1,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(testRedis as any).on('error', () => {});

/** Deletes every key matching any of the given glob patterns. */
export async function flushKeys(patterns: string[]): Promise<void> {
  for (const pattern of patterns) {
    let cursor = '0';
    do {
      const [next, keys] = await testRedis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (keys.length) await testRedis.del(...keys);
    } while (cursor !== '0');
  }
}

/** Wipes the whole test Redis. Call between suites, not inside a file that shares keys. */
export async function flushAll(): Promise<void> {
  await testRedis.flushall();
}

export async function closeTestRedis(): Promise<void> {
  await testRedis.quit().catch(() => undefined);
}
