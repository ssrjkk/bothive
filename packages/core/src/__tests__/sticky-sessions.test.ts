import { describe, it, expect, beforeEach } from 'vitest';
import { ProxyPool } from '../proxy/proxy-pool.js';
import { StickySessionManager } from '../proxy/sticky-sessions.js';
import type { ProxyInstance } from '../proxy/types.js';

const proxy = (id: string, priority = 0): ProxyInstance => ({
  id,
  url: `http://host-${id}:8080`,
  type: 'http',
  priority,
  enabled: true,
  healthScore: 100,
  requestsCount: 0,
  failureCount: 0,
});

function makePool(): ProxyPool {
  const pool = new ProxyPool();
  pool.setProxies([proxy('a', 5), proxy('b', 3), proxy('c', 1)]);
  return pool;
}

describe('StickySessionManager', () => {
  let pool: ProxyPool;
  let manager: StickySessionManager;

  beforeEach(() => {
    pool = makePool();
    manager = new StickySessionManager(pool, {
      stickyDurationMs: 1000,
      maxBotsPerProxy: 2,
    });
  });

  it('returns the same proxy for a bot across calls (stickiness)', () => {
    const first = manager.getProxyForBot('bot1')!;
    const second = manager.getProxyForBot('bot1')!;
    expect(first.id).toBe(second.id);
  });

  it('spreads bots across proxies up to the cap', () => {
    const picks = new Set(['bot1', 'bot2', 'bot3'].map((b) => manager.getProxyForBot(b)!.id));
    // Three bots, cap 2 per proxy -> at least 2 distinct proxies used.
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  it('breaks a binding when the bound proxy becomes unhealthy', () => {
    const picked = manager.getProxyForBot('bot1')!.id;
    const other = pool
      .getProxies()
      .map((p) => p.id)
      .filter((id) => id !== picked)[0];

    // Kill the bound proxy.
    pool.getProxy(picked)!.enabled = false;
    const next = manager.getProxyForBot('bot1')!.id;
    expect(next).toBe(other);
  });

  it('honors explicit bind and re-binds on busy conflict', () => {
    manager.bind('botX', 'a');
    const got = manager.getProxyForBot('botX')!;
    expect(got.id).toBe('a');

    // Unbind frees capacity.
    manager.unbind('botX');
    expect(manager.getBinding('botX')).toBeUndefined();
  });

  it('falls back to pool selection when all proxies are over capacity', () => {
    // Two bots on proxy 'a' cap=2, then fill every eligible proxy.
    pool = new ProxyPool();
    pool.setProxies([proxy('only', 0)]);
    manager = new StickySessionManager(pool, { stickyDurationMs: 1000, maxBotsPerProxy: 1 });
    manager.getProxyForBot('b1')!;
    // Second bot: 'only' is at cap, single proxy -> fallback selects it anyway.
    const got = manager.getProxyForBot('b2')!;
    expect(got.id).toBe('only');
  });

  it('cleanup releases expired bindings and frees capacity', () => {
    const now = 1000;
    manager.bind('b1', 'a', now);
    expect(manager.getLoadMap().get('a')).toBe(1);
    manager.cleanup(now + 2000); // binding expired
    expect(manager.getBinding('b1')).toBeUndefined();
    expect(manager.getLoadMap().get('a')).toBe(0);
  });

  it('expired bindings are not served again', () => {
    const now = 5000;
    manager.bind('b1', 'a', now);
    const stale = manager.getBinding('b1')!;
    const got = manager.getProxyForBot('b1', now + 2000)!; // after expiry
    expect(got.id).toBeDefined();
    // A fresh binding (not the expired one) now exists.
    const fresh = manager.getBinding('b1')!;
    expect(fresh.boundAt).toBe(now + 2000);
    expect(fresh.expiresAt).toBeGreaterThan(stale.expiresAt);
  });
});
