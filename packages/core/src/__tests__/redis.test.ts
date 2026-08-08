import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { redisConnectionOptions } from '../utils/redis.js';

describe('redisConnectionOptions', () => {
  const original = process.env.REDIS_PASSWORD;

  beforeEach(() => {
    delete process.env.REDIS_PASSWORD;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_PASSWORD;
    else process.env.REDIS_PASSWORD = original;
    vi.restoreAllMocks();
  });

  it('returns maxRetriesPerRequest: null and no password when REDIS_PASSWORD is unset', () => {
    expect(redisConnectionOptions()).toEqual({ maxRetriesPerRequest: null });
  });

  it('layers the password on when REDIS_PASSWORD is set', () => {
    process.env.REDIS_PASSWORD = 'hunter2';
    expect(redisConnectionOptions()).toEqual({ maxRetriesPerRequest: null, password: 'hunter2' });
  });
});
