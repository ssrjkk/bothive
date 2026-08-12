import { describe, it, expect } from 'vitest';
import { RedisRateLimiter } from '../utils/redis-rate-limiter.js';
import type { RateLimitClient } from '../utils/redis-rate-limiter.js';

function failingClient(): RateLimitClient {
  return {
    incr: async () => {
      throw new Error('Redis is down');
    },
    pexpire: async () => {
      throw new Error('Redis is down');
    },
    get: async () => {
      throw new Error('Redis is down');
    },
  };
}

describe('RedisRateLimiter', () => {
  it('counts against Redis when the client responds', async () => {
    const calls: string[] = [];
    const client: RateLimitClient = {
      incr: async (key) => {
        calls.push(`incr:${key}`);
        return 1;
      },
      pexpire: async (key) => {
        calls.push(`pexpire:${key}`);
        return 1;
      },
    };
    const limiter = new RedisRateLimiter(client, 'rl:test', 3, 1000);
    expect(await limiter.check('ip:1')).toBe(true);
    expect(calls).toEqual(['incr:rl:test:ip:1', 'pexpire:rl:test:ip:1']);
  });

  it('blocks when the Redis counter is over the limit', async () => {
    const client: RateLimitClient = {
      incr: async () => 4,
      pexpire: async () => 1,
    };
    const limiter = new RedisRateLimiter(client, 'rl:test', 3, 1000);
    expect(await limiter.check('ip:1')).toBe(false);
  });

  it('falls back to the in-memory limiter with no client', async () => {
    const limiter = new RedisRateLimiter(null, 'rl:test', 1, 50);
    expect(await limiter.check('ip:1')).toBe(true);
    expect(await limiter.check('ip:1')).toBe(false);
  });

  it('degrades to the in-memory limiter when Redis is unavailable', async () => {
    const limiter = new RedisRateLimiter(failingClient(), 'rl:test', 1, 50);
    expect(await limiter.check('ip:1')).toBe(true);
    expect(await limiter.check('ip:1')).toBe(false);
  });

  it('recovers to Redis once the client responds again', async () => {
    let down = true;
    const client: RateLimitClient = {
      incr: async () => {
        if (down) throw new Error('Redis is down');
        return 1;
      },
      pexpire: async () => 1,
    };
    const limiter = new RedisRateLimiter(client, 'rl:test', 1, 50);
    expect(await limiter.check('ip:1')).toBe(true);
    expect(await limiter.check('ip:1')).toBe(false);
    down = false;
    expect(await limiter.check('ip:1')).toBe(true);
  });

  it('reports the Redis-backed remaining count', async () => {
    const client: RateLimitClient = {
      incr: async () => 1,
      pexpire: async () => 1,
      get: async () => 2,
    };
    const limiter = new RedisRateLimiter(client, 'rl:test', 5, 1000);
    expect(await limiter.getRemaining('ip:1')).toBe(3);
  });

  it('falls back for getRemaining when Redis is unavailable', async () => {
    const limiter = new RedisRateLimiter(failingClient(), 'rl:test', 3, 1000);
    await limiter.check('ip:1');
    expect(await limiter.getRemaining('ip:1')).toBe(2);
  });
});
