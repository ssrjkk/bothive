import { Redis } from 'ioredis';
import type { BotMemoryStore, MemoryEntry } from './bot-memory.js';
import { redisConnectionOptions } from '../utils/redis.js';

export class RedisMemoryStore implements BotMemoryStore {
  private redis: Redis;
  private prefix: string;

  constructor(redisUrl: string, prefix: string = 'bothive:mem') {
    this.redis = new Redis(redisUrl, redisConnectionOptions());
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
      return JSON.parse(raw) as MemoryEntry<T>;
    } catch {
      return undefined;
    }
  }

  async set<T>(botId: string, key: string, value: T, ttl?: number): Promise<void> {
    const entry: MemoryEntry<T> = {
      key,
      value,
      ttl,
      createdAt: new Date(),
      expiresAt: ttl ? new Date(Date.now() + ttl * 1000) : undefined,
    };

    const serialized = JSON.stringify(entry);
    const redisKey = this.key(botId, key);

    if (ttl) {
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
    for (const v of values) {
      if (v === null) continue;
      try {
        result.push(JSON.parse(v) as MemoryEntry<T>);
      } catch {
        // skip corrupt entries
      }
    }
    return result;
  }

  async increment(botId: string, key: string, by: number = 1): Promise<number> {
    const redisKey = this.key(botId, key);
    const value = await this.redis.incrby(redisKey, by);
    return value;
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
