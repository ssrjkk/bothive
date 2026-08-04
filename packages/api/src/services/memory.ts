import { Redis } from 'ioredis';

const PREFIX = 'bothive:mem';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
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
      entries.push({ key: keys[i].slice(PREFIX.length + 1), value: raw, createdAt: new Date().toISOString() });
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

export async function disconnectMemory(): Promise<void> {
  await redis.quit().catch(() => undefined);
}
