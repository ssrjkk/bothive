import { Redis } from 'ioredis';
import type { BotMemoryStore, MemoryEntry } from './bot-memory.js';
import { redisCommandOptions } from '../utils/redis.js';

export class RedisMemoryStore implements BotMemoryStore {
  private redis: Redis;
  private prefix: string;

  constructor(redisUrl: string, prefix: string = 'bothive:mem') {
    this.redis = new Redis(redisUrl, redisCommandOptions());
    // Without an 'error' listener ioredis throws an uncaught 'error' event that
    // can crash the process on a dropped connection/reconnect.
    this.redis.on('error', (err) => {
      console.error(`[RedisMemoryStore] Redis error:`, err?.message ?? err);
    });
    this.prefix = prefix;
  }

  private key(botId: string, key: string): string {
    return `${this.prefix}:${botId}:${key}`;
  }

  private scanKeys(botId: string): string {
    return `${this.prefix}:${botId}:*`;
  }

  async get<T>(botId: string, key: string): Promise<MemoryEntry<T> | undefined> {
    const raw = await this.redis.get(this.key(botId, key));
    if (!raw) return undefined;

    try {
      const parsed = JSON.parse(raw) as MemoryEntry<T>;
      if (parsed !== null && typeof parsed === 'object') return parsed;
      // Counter keys are stored as raw numbers by `increment` (see below).
      return { key, value: parsed as T, ttl: undefined, createdAt: new Date() };
    } catch {
      return undefined;
    }
  }

  async set<T>(botId: string, key: string, value: T, ttl?: number): Promise<void> {
    const hasTtl = typeof ttl === 'number' && ttl > 0;
    const entry: MemoryEntry<T> = {
      key,
      value,
      ttl: hasTtl ? ttl : undefined,
      createdAt: new Date(),
      expiresAt: hasTtl ? new Date(Date.now() + ttl * 1000) : undefined,
    };

    const serialized = JSON.stringify(entry);
    const redisKey = this.key(botId, key);

    if (hasTtl) {
      await this.redis.setex(redisKey, ttl, serialized);
    } else {
      await this.redis.set(redisKey, serialized);
    }
  }

  async delete(botId: string, key: string): Promise<void> {
    await this.redis.del(this.key(botId, key));
  }

  async clear(botId: string): Promise<void> {
    const pattern = this.scanKeys(botId);
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  async getAll<T>(botId: string): Promise<MemoryEntry<T>[]> {
    const pattern = this.scanKeys(botId);
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, found] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...found);
    } while (cursor !== '0');

    if (keys.length === 0) return [];

    const values = await this.redis.mget(...keys);
    const result: MemoryEntry<T>[] = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null) continue;
      try {
        const parsed = JSON.parse(v) as MemoryEntry<T>;
        if (parsed !== null && typeof parsed === 'object') {
          result.push(parsed);
        } else {
          // Raw counter value written by `increment`.
          result.push({
            key: keys[i].slice(this.prefix.length + 1),
            value: parsed as T,
            ttl: undefined,
            createdAt: new Date(),
          });
        }
      } catch {
        // skip corrupt entries
      }
    }
    return result;
  }

  async increment(botId: string, key: string, by: number = 1, ttl?: number): Promise<number> {
    const redisKey = this.key(botId, key);
    // Atomic INCRBY + EXPIRE (armed only on the first increment) so counters
    // cannot leak indefinitely and concurrent incrementers never leave a key
    // without an expiry.
    const script =
      'local c = redis.call("INCRBY", KEYS[1], ARGV[1]);' +
      'if c == tonumber(ARGV[1]) and tonumber(ARGV[2]) > 0 then' +
      '  redis.call("EXPIRE", KEYS[1], ARGV[2]);' +
      'end;' +
      'return c';
    const value = (await this.redis.eval(script, 1, redisKey, by, ttl ?? 0)) as number;
    return value;
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
