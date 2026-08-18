import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';

const PREFIX = 'bothive:mem';

const redis = new Redis(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
  redisConnectionOptions(),
);

// Without an 'error' listener ioredis emits an uncaught 'error' event on a
// dropped connection and would crash the whole API process.
redis.on('error', (err) => {
  console.error('[api] memory Redis error:', err?.message ?? err);
});

export interface MemoryEntry {
  key: string;
  value: unknown;
  ttl?: number;
  createdAt: string;
  expiresAt?: string;
}

async function scanKeys(botId: string): Promise<string[]> {
  const pattern = `${PREFIX}:${botId}:*`;
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    keys.push(...found);
  } while (cursor !== '0');
  return keys;
}

export async function getBotMemory(botId: string): Promise<MemoryEntry[]> {
  const keys = await scanKeys(botId);
  if (keys.length === 0) return [];

  const values = await redis.mget(...keys);
  const entries: MemoryEntry[] = [];
  for (let i = 0; i < keys.length; i++) {
    const raw = values[i];
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw) as MemoryEntry;
      if (parsed && typeof parsed.key === 'string') {
        entries.push(parsed);
      }
    } catch {
      entries.push({
        key: keys[i].slice(PREFIX.length + 1),
        value: raw,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

export async function deleteBotMemoryKey(botId: string, key: string): Promise<boolean> {
  const deleted = await redis.del(`${PREFIX}:${botId}:${key}`);
  return deleted > 0;
}

export async function clearBotMemory(botId: string): Promise<number> {
  const keys = await scanKeys(botId);
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}

const CRYPTO_POSITIONS_PREFIX = 'bothive:crypto:positions:';
const CRYPTO_DAILY_PREFIX = 'bothive:crypto:daily:';

async function scanAndDelete(pattern: string): Promise<number> {
  let deleted = 0;
  let cursor = '0';
  do {
    const [next, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    if (found.length > 0) deleted += await redis.del(...found);
  } while (cursor !== '0');
  return deleted;
}

/**
 * Deletes all Redis state belonging to a bot that is being removed: bot memory
 * keys, dry-run positions and the daily-spend counter. The keys would otherwise
 * linger after the bot row is gone (dry positions carry no TTL).
 */
export async function deleteBotRuntimeState(botId: string): Promise<number> {
  let deleted = await clearBotMemory(botId);
  deleted += await scanAndDelete(`${CRYPTO_DAILY_PREFIX}${botId}:*`);
  deleted += await redis.del(`${CRYPTO_POSITIONS_PREFIX}${botId}`);
  return deleted;
}

export async function disconnectMemory(): Promise<void> {
  await redis.quit().catch(() => undefined);
}
