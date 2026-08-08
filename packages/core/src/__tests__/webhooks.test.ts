import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  isWebhookUrlAllowed,
  isPrivateIp,
  assertWebhookUrlAllowed,
  deliverWebhook,
  signPayload,
} from '../webhooks/index.js';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

// assertWebhookUrlAllowed calls lookup(host, { all: true }) → Promise<LookupAddress[]>,
// but vi.mocked picks the single-address overload, so type the mock explicitly.
function mockLookupAll(addresses: LookupAddress[]): void {
  (
    vi.mocked(lookup) as unknown as Mock<
      (hostname: string, options: { all: true }) => Promise<LookupAddress[]>
    >
  ).mockResolvedValue(addresses);
}

describe('isPrivateIp', () => {
  it('classifies private and reserved ranges', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('192.168.1.5')).toBe(true);
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('169.254.169.254')).toBe(true);
    expect(isPrivateIp('100.64.0.1')).toBe(true);
    expect(isPrivateIp('224.0.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false);
  });
});

describe('isWebhookUrlAllowed', () => {
  afterEach(() => {
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
  });

  it('allows public http(s) URLs', () => {
    expect(isWebhookUrlAllowed('https://example.com/hook')).toBe(true);
    expect(isWebhookUrlAllowed('http://example.com:8080/hook')).toBe(true);
    expect(isWebhookUrlAllowed('https://8.8.8.8/hook')).toBe(true);
  });

  it('rejects non-http schemes and invalid URLs', () => {
    expect(isWebhookUrlAllowed('ftp://example.com/hook')).toBe(false);
    expect(isWebhookUrlAllowed('file:///etc/passwd')).toBe(false);
    expect(isWebhookUrlAllowed('not-a-url')).toBe(false);
  });

  it('blocks literal private, loopback and link-local hosts', () => {
    expect(isWebhookUrlAllowed('http://127.0.0.1:3000/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://localhost:8080/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://10.0.0.5/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://192.168.1.10/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://172.16.4.4/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isWebhookUrlAllowed('http://[::1]:8080/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://foo.local/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://example.internal/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://router.home/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://server.corp/x')).toBe(false);
  });

  it('blocks IPv4 integer, hex and dotted-shorthand notations', () => {
    expect(isWebhookUrlAllowed('http://2130706433/x')).toBe(false); // 127.0.0.1
    expect(isWebhookUrlAllowed('http://3232235777/x')).toBe(false); // 192.168.1.1
    expect(isWebhookUrlAllowed('http://0x7f000001/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://0xC0A80101/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://127.1/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://127.0.1/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://192.168.1/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://2130706433:8080/x')).toBe(false);
  });

  it('allows public integer/hex notations', () => {
    expect(isWebhookUrlAllowed('http://134744072/x')).toBe(true); // 8.8.8.8
    expect(isWebhookUrlAllowed('http://0x08080808/x')).toBe(true);
  });

  it('blocks IPv4-mapped and IPv4-compatible IPv6 literals', () => {
    expect(isWebhookUrlAllowed('http://[::ffff:127.0.0.1]/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://[::ffff:7f00:1]/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://[::ffff:10.0.0.1]/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://[::127.0.0.1]/x')).toBe(false);
    expect(isWebhookUrlAllowed('http://[::7f00:1]/x')).toBe(false);
  });

  it('allows mapped IPv6 pointing at public addresses', () => {
    expect(isWebhookUrlAllowed('http://[::ffff:8.8.8.8]/x')).toBe(true);
    expect(isWebhookUrlAllowed('http://[::ffff:808:808]/x')).toBe(true);
  });

  it('honors the ALLOW_PRIVATE_WEBHOOK_URLS override', () => {
    process.env.ALLOW_PRIVATE_WEBHOOK_URLS = 'true';
    expect(isWebhookUrlAllowed('http://127.0.0.1:3000/x')).toBe(true);
    expect(isWebhookUrlAllowed('http://10.0.0.1/x')).toBe(true);
  });

  it('is pure and never performs network I/O', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(isWebhookUrlAllowed('https://example.com')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('assertWebhookUrlAllowed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(lookup).mockReset();
    delete process.env.WEBHOOK_DNS_CHECK;
  });

  it('is synchronous-only by default and performs no DNS I/O', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(assertWebhookUrlAllowed('https://example.com/hook')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects when DNS resolution points at a private address', async () => {
    mockLookupAll([{ address: '192.168.1.1', family: 4 }]);
    process.env.WEBHOOK_DNS_CHECK = 'true';
    await expect(assertWebhookUrlAllowed('https://evil.example.com/hook')).rejects.toThrow(
      'private address',
    );
  });

  it('rejects unresolvable hosts when DNS check is enabled', async () => {
    const err = new Error('queryA ENOTFOUND') as NodeJS.ErrnoException;
    err.code = 'ENOTFOUND';
    vi.mocked(lookup).mockRejectedValue(err);
    process.env.WEBHOOK_DNS_CHECK = 'true';
    await expect(assertWebhookUrlAllowed('https://no-such-host.invalid/hook')).rejects.toThrow(
      'does not resolve',
    );
  });
});

describe('deliverWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
  });

  function fakeRes(status: number, headers: Record<string, string> = {}) {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    } as Response;
  }

  it('adds the HMAC signature header when a secret is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeRes(200));
    vi.stubGlobal('fetch', fetchMock);
    await deliverWebhook('https://example.com/hook', 's3cret', '{"a":1}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-bothive-signature']).toBe(`sha256=${signPayload('s3cret', '{"a":1}')}`);
  });

  it('re-validates each redirect hop and blocks internal hosts', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(fakeRes(302, { location: 'http://127.0.0.1:9999/internal' }))
        .mockResolvedValueOnce(fakeRes(200)),
    );
    await expect(deliverWebhook('https://example.com/hook', null, '{}')).rejects.toThrow(
      'not allowed',
    );
  });

  it('caps the number of redirects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeRes(301, { location: 'https://example.com/again' })),
    );
    await expect(deliverWebhook('https://example.com/hook', null, '{}')).rejects.toThrow(
      'maximum redirects',
    );
    expect((vi.mocked(fetch) as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(6);
  });

  it('aborts requests that exceed the timeout', async () => {
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('Aborted'));
            });
          }),
      ),
    );
    await expect(deliverWebhook('https://example.com/hook', null, '{}', 20)).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});
