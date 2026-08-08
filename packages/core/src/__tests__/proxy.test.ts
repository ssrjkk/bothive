import { describe, it, expect } from 'vitest';
import { ProxyPool } from '../proxy/proxy-pool.js';
import { parseProxyUrl, isValidProxyUrl, maskProxyUrl } from '../proxy/proxy-validator.js';
import type { ProxyInstance } from '../proxy/types.js';

const proxy = (overrides: Partial<ProxyInstance> = {}): ProxyInstance => ({
  id: 'p1',
  url: 'http://host1:8080',
  type: 'http',
  priority: 0,
  enabled: true,
  healthScore: 100,
  requestsCount: 0,
  failureCount: 0,
  ...overrides,
});

describe('ProxyPool', () => {
  it('returns undefined when the pool is empty', () => {
    const pool = new ProxyPool();
    expect(pool.selectProxy()).toBeUndefined();
  });

  it('returns undefined when every proxy is disabled or unhealthy', () => {
    const pool = new ProxyPool();
    pool.setProxies([
      proxy({ id: 'a', enabled: false }),
      proxy({ id: 'b', healthScore: 0 }),
      proxy({ id: 'c', lastFailedAt: new Date().toISOString() }), // in cooldown
    ]);
    expect(pool.selectProxy()).toBeUndefined();
  });

  it('prefers the highest priority tier and rotates round-robin inside it', () => {
    const pool = new ProxyPool();
    pool.setProxies([
      proxy({ id: 'lo', priority: 0 }),
      proxy({ id: 'hi1', priority: 10 }),
      proxy({ id: 'hi2', priority: 10 }),
    ]);
    const picks = [pool.selectProxy()!.id, pool.selectProxy()!.id, pool.selectProxy()!.id];
    // Never the low-priority proxy; high tier alternates.
    expect(picks).toEqual(['hi1', 'hi2', 'hi1']);
  });

  it('skips a proxy during its failure cooldown and falls back to the next one', () => {
    const pool = new ProxyPool();
    const failed = proxy({ id: 'dead', priority: 5, lastFailedAt: new Date().toISOString() });
    const alive = proxy({ id: 'alive', priority: 0 });
    pool.setProxies([failed, alive]);
    // dead is top priority but cooling down -> alive is selected.
    expect(pool.selectProxy()!.id).toBe('alive');
    // After the cooldown lapses it becomes eligible again.
    const later = Date.now() + 60_000;
    expect(pool.selectProxy(later)!.id).toBe('dead');
  });

  it('decays health on failure and excludes the proxy at zero', () => {
    const pool = new ProxyPool();
    pool.setProxies([proxy({ id: 'a' })]);
    pool.reportFailure('a');
    pool.reportFailure('a');
    pool.reportFailure('a');
    pool.reportFailure('a');
    expect(pool.getProxy('a')!.healthScore).toBe(0);
    expect(pool.getProxy('a')!.failureCount).toBe(4);
    expect(pool.selectProxy()).toBeUndefined();
  });

  it('recovers health on success and counts requests', () => {
    const pool = new ProxyPool();
    pool.setProxies([proxy({ id: 'a', healthScore: 40 })]);
    pool.reportSuccess('a');
    expect(pool.getProxy('a')!.healthScore).toBe(45);
    expect(pool.getProxy('a')!.requestsCount).toBe(1);
  });

  it('upsert adds new proxies and updates existing ones', () => {
    const pool = new ProxyPool();
    pool.upsert(proxy({ id: 'a' }));
    pool.upsert(proxy({ id: 'a', priority: 3 }));
    expect(pool.getProxies()).toHaveLength(1);
    expect(pool.getProxy('a')!.priority).toBe(3);
    pool.remove('a');
    expect(pool.getProxies()).toHaveLength(0);
  });
});

describe('proxy-validator', () => {
  it('parses http urls with optional credentials', () => {
    expect(parseProxyUrl('http://user:pass@proxy.example:3128')).toEqual({
      protocol: 'http',
      hostname: 'proxy.example',
      port: 3128,
      username: 'user',
      password: 'pass',
    });
    expect(parseProxyUrl('http://plain@proxy.example:3128')).toEqual({
      protocol: 'http',
      hostname: 'proxy.example',
      port: 3128,
      username: 'plain',
    });
  });

  it('parses socks5 and normalizes socks5h', () => {
    expect(parseProxyUrl('socks5://host:1080')!.protocol).toBe('socks5');
    expect(parseProxyUrl('socks5h://host:1080')!.protocol).toBe('socks5');
  });

  it('rejects malformed urls', () => {
    for (const bad of ['http://', 'ftp://host:1', 'http://host', 'socks4://host:1', 'http://host:99999', 'not a url']) {
      expect(parseProxyUrl(bad)).toBeNull();
      expect(isValidProxyUrl(bad)).toBe(false);
    }
  });

  it('masks credentials for safe display', () => {
    expect(maskProxyUrl('http://user:pass@host:3128')).toBe('http://host:3128');
  });
});
