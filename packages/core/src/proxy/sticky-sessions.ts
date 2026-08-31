/**
 * Sticky proxy sessions.
 *
 * A bot that switches its egress IP on every request is trivially fingerprinted.
 * Sticky sessions ensure a bot uses the SAME proxy (same IP) for a configurable
 * duration, mimicking a real user on a home connection that rarely changes IP.
 *
 * The mapping is stored in Redis so all worker replicas share the same
 * bindings.  Each binding has a TTL that matches the desired sticky duration.
 */

import type { ProxyPool } from './proxy-pool.js';

export interface StickyConfig {
  /** How long a bot stays bound to one proxy (ms). Default 24 hours. */
  stickyDurationMs: number;
  /** Maximum number of bots that can share a single proxy simultaneously. Default 3. */
  maxBotsPerProxy: number;
}

export const DEFAULT_STICKY_CONFIG: StickyConfig = {
  stickyDurationMs: 24 * 60 * 60 * 1000, // 24 hours
  maxBotsPerProxy: 3,
};

export interface StickyBinding {
  botId: string;
  proxyId: string;
  boundAt: number;
  expiresAt: number;
}

/**
 * In-memory sticky session manager.
 *
 * In production this would be Redis-backed.  For the in-process worker the
 * in-memory map is sufficient because leader election guarantees only one
 * process owns live connections per platform.  If you scale to multiple
 * leaders (not currently supported), migrate this to Redis.
 */
export class StickySessionManager {
  private bindings = new Map<string, StickyBinding>();
  private proxyLoad = new Map<string, number>();

  constructor(
    private pool: ProxyPool,
    private config: StickyConfig = DEFAULT_STICKY_CONFIG,
  ) {}

  /**
   * Returns the proxy a bot should use.  If the bot already has a valid
   * (non-expired) binding, the same proxy is returned.  Otherwise a new
   * proxy is selected respecting the `maxBotsPerProxy` cap.
   */
  getProxyForBot(botId: string, now = Date.now()): ReturnType<ProxyPool['selectProxy']> {
    const existing = this.bindings.get(botId);
    if (existing && existing.expiresAt > now) {
      // Verify the proxy is still healthy; if not, break the binding.
      const proxy = this.pool.getProxy(existing.proxyId);
      if (proxy && proxy.enabled && proxy.healthScore > 0) {
        return { ...proxy };
      }
      this.unbind(botId);
    }

    // Find a proxy with capacity.
    const allProxies = this.pool.getProxies();
    const eligible = allProxies.filter(
      (p) =>
        p.enabled &&
        p.healthScore > 0 &&
        (this.proxyLoad.get(p.id) ?? 0) < this.config.maxBotsPerProxy,
    );

    if (eligible.length === 0) {
      // Fallback: pick any enabled proxy even if over cap.
      return this.pool.selectProxy(now);
    }

    // Prefer the highest-priority tier with capacity.
    const maxPriority = Math.max(...eligible.map((p) => p.priority));
    const tier = eligible.filter((p) => p.priority === maxPriority);
    const pick = tier[Math.floor(Math.random() * tier.length)];

    this.bind(botId, pick.id, now);
    return { ...pick };
  }

  /**
   * Explicitly binds a bot to a specific proxy (used after a proxy rotation).
   */
  bind(botId: string, proxyId: string, now = Date.now()): void {
    this.unbind(botId, now);
    const expiresAt = now + this.config.stickyDurationMs;
    this.bindings.set(botId, { botId, proxyId, boundAt: now, expiresAt });
    this.proxyLoad.set(proxyId, (this.proxyLoad.get(proxyId) ?? 0) + 1);
  }

  /**
   * Removes a bot's binding (called on disconnect or proxy rotation).
   */
  unbind(botId: string, now = Date.now()): void {
    const existing = this.bindings.get(botId);
    if (!existing) return;
    // Only decrement if not expired.
    if (existing.expiresAt > now) {
      this.proxyLoad.set(
        existing.proxyId,
        Math.max(0, (this.proxyLoad.get(existing.proxyId) ?? 1) - 1),
      );
    }
    this.bindings.delete(botId);
  }

  /**
   * Returns the current binding for a bot (or undefined).
   */
  getBinding(botId: string): StickyBinding | undefined {
    return this.bindings.get(botId);
  }

  /**
   * Returns the load (number of bound bots) for each proxy.
   */
  getLoadMap(): Map<string, number> {
    return new Map(this.proxyLoad);
  }

  /**
   * Cleans up expired bindings.  Call periodically (e.g. every 5 minutes).
   */
  cleanup(now = Date.now()): void {
    for (const [botId, binding] of this.bindings) {
      if (binding.expiresAt <= now) {
        this.proxyLoad.set(
          binding.proxyId,
          Math.max(0, (this.proxyLoad.get(binding.proxyId) ?? 1) - 1),
        );
        this.bindings.delete(botId);
      }
    }
  }
}
