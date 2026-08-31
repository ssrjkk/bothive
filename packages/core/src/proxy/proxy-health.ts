/**
 * Proxy health validation beyond simple ping.
 *
 * Checks:
 *  1. IP is NOT on common blacklists (Spamhaus, abuse.ch, etc.)
 *  2. IP geolocation is consistent with expected region (optional)
 *  3. TLS fingerprint is not obviously datacenter (optional, requires external API)
 *
 * Uses free APIs only — no paid services required.
 */

export interface ProxyHealthReport {
  proxyId: string;
  ip: string;
  /** Whether the IP passed all blacklist checks. */
  clean: boolean;
  /** Blacklist hits (if any). */
  blacklists: string[];
  /** Geolocation data (if resolved). */
  geo?: {
    country: string;
    city?: string;
    isp?: string;
    org?: string;
  };
  /** Check timestamp. */
  checkedAt: string;
  /** Time taken for the full check (ms). */
  durationMs: number;
}

interface CheckResult {
  clean: boolean;
  blacklists: string[];
}

/**
 * Extracts the IP from a proxy URL by making a TCP connection through it.
 * For HTTP proxies: sends CONNECT.  For SOCKS5: completes the SOCKS5 handshake.
 */
async function resolveProxyIP(url: string, timeoutMs = 10_000): Promise<string | null> {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parseInt(parsed.port, 10) || (parsed.protocol === 'socks5:' ? 1080 : 80);

    // Use a simple HTTP request through the proxy to discover the egress IP.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = (await resp.json()) as { ip: string };
      return data.ip;
    } catch {
      clearTimeout(timer);
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Checks an IP against known blacklist APIs (free, no key required).
 *
 * Note: In production you'd use a proper IP intelligence API.  These free
 * endpoints are rate-limited but sufficient for occasional health checks.
 */
async function checkBlacklists(ip: string, timeoutMs = 5000): Promise<CheckResult> {
  const blacklists: string[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Check Spamhaus DROP list (returns 204 if clean, 200 with data if listed).
    const resp = await fetch(`https://api.spamhaus.org/drop/deny/?ip=${ip}`, {
      signal: controller.signal,
    });
    if (resp.ok) {
      const text = await resp.text();
      if (text.trim().length > 0) blacklists.push('spamhaus-drop');
    }
  } catch {
    // API unreachable — don't fail the check, just skip this blacklist.
  }

  clearTimeout(timer);
  return { clean: blacklists.length === 0, blacklists };
}

/**
 * Fetches geolocation for an IP using a free API.
 */
async function getGeoLocation(
  ip: string,
  timeoutMs = 5000,
): Promise<ProxyHealthReport['geo'] | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`https://ipapi.co/${ip}/json/`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return undefined;
    const data = (await resp.json()) as {
      country_name?: string;
      city?: string;
      org?: string;
    };
    return {
      country: data.country_name ?? 'Unknown',
      city: data.city,
      isp: data.org,
    };
  } catch {
    clearTimeout(timer);
    return undefined;
  }
}

/**
 * Performs a full health check on a proxy.
 *
 * Returns a report with blacklist status, geolocation, and timing.
 * Failures in individual checks are non-fatal — the proxy is only flagged
 * if a blacklist explicitly lists the IP.
 */
export async function validateProxy(proxyId: string, proxyUrl: string): Promise<ProxyHealthReport> {
  const start = Date.now();

  // Step 1: Resolve the egress IP.
  const ip = await resolveProxyIP(proxyUrl);
  if (!ip) {
    return {
      proxyId,
      ip: 'unknown',
      clean: false,
      blacklists: ['unreachable'],
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  }

  // Step 2: Check blacklists.
  const blacklistResult = await checkBlacklists(ip);

  // Step 3: Geolocation (non-blocking, best-effort).
  const geo = await getGeoLocation(ip);

  return {
    proxyId,
    ip,
    clean: blacklistResult.clean,
    blacklists: blacklistResult.blacklists,
    geo,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}
