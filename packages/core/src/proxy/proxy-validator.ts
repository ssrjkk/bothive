import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { ProxyType } from './types.js';

export interface ParsedProxy {
  protocol: ProxyType;
  hostname: string;
  port: number;
  username?: string;
  password?: string;
}

const URL_RE = /^(https?|socks5|socks5h):\/\/(?:([^@/]+)@)?([^:/]+):(\d{1,5})$/i;

/** Parses a proxy URL like `http://user:pass@host:3128` or `socks5://host:1080`.
 *  `socks5h` is normalized to `socks5` (both resolve the target remotely). */
export function parseProxyUrl(url: string): ParsedProxy | null {
  const match = URL_RE.exec(url.trim());
  if (!match) return null;
  const [, protocolRaw, userinfo, hostname, portRaw] = match;
  const protocol =
    protocolRaw.toLowerCase() === 'socks5h' ? 'socks5' : (protocolRaw.toLowerCase() as ProxyType);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const parsed: ParsedProxy = { protocol, hostname, port };
  if (userinfo) {
    const sep = userinfo.indexOf(':');
    if (sep === -1) {
      parsed.username = decodeURIComponent(userinfo);
    } else {
      parsed.username = decodeURIComponent(userinfo.slice(0, sep));
      parsed.password = decodeURIComponent(userinfo.slice(sep + 1));
    }
  }
  return parsed;
}

export function isValidProxyUrl(url: string): boolean {
  const parsed = parseProxyUrl(url);
  if (!parsed) return false;
  return parsed.protocol === 'http' || parsed.protocol === 'socks5';
}

/** Rebuilds the URL without credentials, safe to return to the dashboard. */
export function maskProxyUrl(url: string): string {
  const parsed = parseProxyUrl(url);
  if (!parsed) return url;
  return `${parsed.protocol}://${parsed.hostname}:${parsed.port}`;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const PROBE_TARGET = 'http://www.gstatic.com/generate_204';

function tcpConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * Dependency-free reachability probe.
 * - HTTP(S) proxies: send an absolute-URI GET through the proxy; any HTTP
 *   response (200/407/403…) proves the proxy endpoint answers. TLS is used for
 *   `https://` proxies.
 * - SOCKS5 proxies: a TCP connect to host:port (the proxy answers the handshake
 *   on the same socket).
 */
function httpProbe(
  protocol: 'http' | 'https',
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const client = protocol === 'https' ? https : http;
    const request = client.request(
      {
        hostname: host,
        port,
        path: PROBE_TARGET,
        method: 'GET',
        headers: { Host: 'www.gstatic.com' },
        timeout: timeoutMs,
      },
      (response) => {
        response.resume();
        resolve(true);
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
    request.end();
  });
}

export function testProxy(url: string, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<boolean> {
  const parsed = parseProxyUrl(url);
  if (!parsed) return Promise.resolve(false);
  if (parsed.protocol === 'socks5') {
    return tcpConnect(parsed.hostname, parsed.port, timeoutMs);
  }
  return httpProbe('http', parsed.hostname, parsed.port, timeoutMs);
}
