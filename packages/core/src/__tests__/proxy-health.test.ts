import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateProxy } from '../proxy/proxy-health.js';

function stubFetch(impl: (url: string) => Promise<unknown>) {
  return vi.stubGlobal('fetch', vi.fn((url) => impl(String(url))) as unknown as typeof fetch);
}

describe('proxy-health validateProxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports unknown IP and unreachable when the egress check fails', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const report = await validateProxy('p1', 'http://proxy:8080');
    expect(report).toMatchObject({
      proxyId: 'p1',
      ip: 'unknown',
      clean: false,
      blacklists: ['unreachable'],
    });
  });

  it('reports a clean proxy with geo when every check passes', async () => {
    stubFetch(async (url) => {
      if (url.includes('ipify')) return { json: async () => ({ ip: '1.2.3.4' }) };
      if (url.includes('spamhaus')) return { ok: true, text: async () => '' };
      if (url.includes('ipapi'))
        return { ok: true, json: async () => ({ country_name: 'US', city: 'NYC', org: 'Acme' }) };
      return { ok: false };
    });
    const report = await validateProxy('p1', 'http://proxy:8080');
    expect(report.ip).toBe('1.2.3.4');
    expect(report.clean).toBe(true);
    expect(report.blacklists).toEqual([]);
    expect(report.geo).toMatchObject({ country: 'US', city: 'NYC' });
  });

  it('flags a proxy listed on the spamhaus DROP blacklist', async () => {
    stubFetch(async (url) => {
      if (url.includes('ipify')) return { json: async () => ({ ip: '5.6.7.8' }) };
      if (url.includes('spamhaus')) return { ok: true, text: async () => 'some-blacklisted-ip' };
      if (url.includes('ipapi')) return { ok: false };
      return { ok: false };
    });
    const report = await validateProxy('p2', 'http://proxy:8080');
    expect(report.clean).toBe(false);
    expect(report.blacklists).toContain('spamhaus-drop');
  });
});
