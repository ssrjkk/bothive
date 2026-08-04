import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../utils/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(3, 1000);
  });

  it('check returns a boolean synchronously', () => {
    expect(typeof limiter.check('ip:1')).toBe('boolean');
  });

  it('allows requests up to the limit, then blocks', () => {
    expect(limiter.check('ip:1')).toBe(true);
    expect(limiter.check('ip:1')).toBe(true);
    expect(limiter.check('ip:1')).toBe(true);
    expect(limiter.check('ip:1')).toBe(false);
    expect(limiter.check('ip:1')).toBe(false);
  });

  it('tracks keys independently', () => {
    for (let i = 0; i < 3; i++) limiter.check('ip:a');
    expect(limiter.check('ip:b')).toBe(true);
    expect(limiter.check('ip:a')).toBe(false);
  });

  it('reports remaining capacity', () => {
    expect(limiter.getRemaining('ip:1')).toBe(3);
    limiter.check('ip:1');
    expect(limiter.getRemaining('ip:1')).toBe(2);
  });

  it('resets after the window elapses', async () => {
    const fast = new RateLimiter(1, 50);
    expect(fast.check('ip:1')).toBe(true);
    expect(fast.check('ip:1')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fast.check('ip:1')).toBe(true);
  });
});
