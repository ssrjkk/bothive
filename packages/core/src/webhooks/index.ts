import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export const WEBHOOK_EVENT_TYPES = [
  'message',
  'follow',
  'subscribe',
  'donation',
  'comment',
  'interval',
  'status',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

const MAX_REDIRECTS = 5;

export function signPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function uint32ToIpv4(value: number): string {
  return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
}

/**
 * Extracts an embedded IPv4 address from IPv4-mapped/compatible IPv6 literals:
 *   ::ffff:127.0.0.1, ::ffff:7f00:1, ::127.0.0.1
 * These resolve to loopback/private IPv4 and must not slip past the guard.
 */
function ipv4FromMappedV6(ip: string): string | null {
  const lower = ip.toLowerCase();

  let m = lower.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (octets.every((o) => o >= 0 && o <= 255)) return octets.join('.');
    return null;
  }

  m = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    const value = ((parseInt(m[1], 16) & 0xffff) << 16) + (parseInt(m[2], 16) & 0xffff);
    return uint32ToIpv4(value);
  }

  m = lower.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    // IPv4-compatible form, e.g. ::127.0.0.1 which WHATWG URL canonicalizes
    // to ::7f00:1. The low 32 bits encode the IPv4 address.
    const value = ((parseInt(m[1], 16) & 0xffff) << 16) + (parseInt(m[2], 16) & 0xffff);
    return uint32ToIpv4(value);
  }

  m = lower.match(/^::(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (octets.every((o) => o >= 0 && o <= 255)) return octets.join('.');
    return null;
  }

  return null;
}

/**
 * Normalizes the many textual IPv4 notations into dotted-quad candidates so the
 * guard can evaluate them. Handles decimal integers (2130706433), hex (0x7f000001),
 * and dotted shorthands (127.1, 127.0.1). Returns null when the host is not an IP
 * literal in any notation.
 */
function toIpv4Candidates(host: string): string[] | null {
  const lower = host.toLowerCase();
  let value: number;

  if (/^\d+$/.test(lower)) {
    value = parseInt(lower, 10);
  } else if (/^0x[0-9a-f]+$/.test(lower)) {
    value = parseInt(lower.slice(2), 16);
  } else if (lower.includes('.')) {
    const parts = lower.split('.');
    if (parts.length < 2 || parts.length > 4) return null;
    if (!parts.every((p) => /^\d{1,3}$/.test(p))) return null;
    const nums = parts.map((p) => parseInt(p, 10));
    if (nums.some((n) => Number.isNaN(n) || n > 255)) return null;
    value = 0;
    for (const n of nums) value = value * 256 + n;
  } else {
    return null;
  }

  if (value < 0 || value > 0xffffffff) return null;
  return [uint32ToIpv4(value)];
}

export function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  const version = isIP(ip);

  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0) return true; // "this" network
    if (a === 10) return true; // RFC 1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
    if (a === 192 && b === 168) return true; // RFC 1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true; // unspecified + loopback
    const embedded = ipv4FromMappedV6(lower);
    if (embedded) return isPrivateIp(embedded); // ::ffff:127.0.0.1 etc.
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (/^fe[89ab]/.test(lower)) return true; // link-local
    if (lower.startsWith('ff')) return true; // multicast
    if (lower.startsWith('2002:')) return true; // 6to4 can tunnel private IPv4
    if (lower.startsWith('2001:0:')) return true; // teredo can tunnel private IPv4
    return false;
  }

  return false;
}

const PRIVATE_HOSTNAME_PATTERN = /(^|\.)(local|internal|home|lan|corp|localhost)$/i;

/**
 * Synchronous, literal-only SSRF guard. Rejects non-http(s) schemes and any host
 * that is loopback, RFC1918, link-local, ULA, reserved, or an IPv4 shorthand/mapped
 * form that resolves to a private address. DNS-based checks are handled
 * asynchronously by assertWebhookUrlAllowed.
 */
export function isWebhookUrlAllowed(rawUrl: string): boolean {
  if (process.env.ALLOW_PRIVATE_WEBHOOK_URLS === 'true') return true;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const rawHost = url.hostname.toLowerCase();
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;

  if (host === 'localhost' || PRIVATE_HOSTNAME_PATTERN.test(host)) return false;

  const ipv4 = toIpv4Candidates(host);
  if (ipv4) return ipv4.every((ip) => !isPrivateIp(ip));

  if (isIP(host) === 6) {
    const embedded = ipv4FromMappedV6(host);
    if (embedded) return !isPrivateIp(embedded);
    return !isPrivateIp(host);
  }

  return true;
}

/**
 * Full SSRF guard used before delivering a webhook. Runs the literal checks and,
 * when WEBHOOK_DNS_CHECK=true, resolves hostnames and rejects any that resolve to
 * private/loopback addresses (DNS-rebinding-resilient per-hop because callers
 * re-run this on every redirect).
 */
export async function assertWebhookUrlAllowed(rawUrl: string): Promise<void> {
  if (!isWebhookUrlAllowed(rawUrl)) {
    throw new Error('Webhook URL is not allowed (non-http(s) or private/loopback address)');
  }
  if (process.env.WEBHOOK_DNS_CHECK !== 'true') return;

  const url = new URL(rawUrl);
  const rawHost = url.hostname.toLowerCase();
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;

  if (toIpv4Candidates(host) || isIP(host) !== 0) return; // literal IP — already checked

  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      throw new Error(`Webhook URL host does not resolve: ${host}`, { cause: err });
    }
    throw err;
  }
  for (const address of addresses) {
    if (isPrivateIp(address.address)) {
      throw new Error(
        `Webhook URL host ${host} resolves to a private address (${address.address})`,
      );
    }
  }
}

/**
 * Generic fetch with the full SSRF guard applied on EVERY redirect hop
 * (a Location header pointing at an internal host is rejected), a redirect cap,
 * and a hard timeout. Returns the final (non-redirect) response without judging
 * the status code — callers decide how to treat non-2xx responses.
 */
export async function fetchWithGuard(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<Response> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertWebhookUrlAllowed(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(current, { ...init, signal: controller.signal, redirect: 'manual' });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new Error('webhook redirected without a Location header');
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new Error('webhook redirected to an invalid URL');
        }
        current = next.toString();
        continue;
      }

      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('webhook exceeded maximum redirects');
}

/**
 * Delivers a webhook payload. Every hop (including redirects) is validated by the
 * full SSRF guard, hop count is capped, and the request is bounded by a timeout.
 */
export async function deliverWebhook(
  url: string,
  secret: string | null,
  body: string,
  timeoutMs = 5000,
): Promise<void> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'BotHive/1.0',
    accept: 'application/json',
  };
  if (secret) headers['x-bothive-signature'] = `sha256=${signPayload(secret, body)}`;

  const res = await fetchWithGuard(url, { method: 'POST', headers, body }, timeoutMs);
  if (!res.ok) throw new Error(`webhook responded with status ${res.status}`);
}
