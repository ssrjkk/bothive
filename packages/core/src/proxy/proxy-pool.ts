import type { ProxyInstance } from './types.js';

const HEALTH_DECAY_ON_FAILURE = 25;
const HEALTH_BOOST_ON_SUCCESS = 5;
/** A proxy that just failed is skipped for this long so a dead endpoint is not
 *  hammered on every select. */
const FAILURE_COOLDOWN_MS = 30_000;

/**
 * In-memory pool of outbound proxies with weighted selection, round-robin
 * failover and health tracking. Workers refresh the pool from the database
 * (see `BaseWorker.refreshProxies`) and call `selectProxy()` right before a
 * connect so the platform credentials carry `proxy` / `proxyType`.
 *
 * Selection strategy: only enabled proxies with `healthScore > 0` that are not
 * in their failure cooldown are eligible. The highest-priority tier is chosen
 * and rotated round-robin, so healthy high-priority proxies share load and a
 * dead one is skipped until it recovers or its cooldown lapses.
 */
export class ProxyPool {
  private list: ProxyInstance[] = [];
  private cursor = 0;

  setProxies(proxies: ProxyInstance[]): void {
    this.list = [...proxies];
    this.cursor = 0;
  }

  getProxies(): ProxyInstance[] {
    return this.list.map((p) => ({ ...p }));
  }

  getProxy(id: string): ProxyInstance | undefined {
    return this.list.find((p) => p.id === id);
  }

  upsert(proxy: ProxyInstance): void {
    const existing = this.getProxy(proxy.id);
    if (existing) {
      Object.assign(existing, proxy);
    } else {
      this.list.push(proxy);
    }
  }

  remove(id: string): boolean {
    const before = this.list.length;
    this.list = this.list.filter((p) => p.id !== id);
    return this.list.length !== before;
  }

  clear(): void {
    this.list = [];
    this.cursor = 0;
  }

  selectProxy(now = Date.now()): ProxyInstance | undefined {
    const candidates = this.list.filter(
      (p) => p.enabled && p.healthScore > 0 && !this.inCooldown(p, now),
    );
    if (candidates.length === 0) return undefined;

    const maxPriority = Math.max(...candidates.map((c) => c.priority));
    const tier = candidates.filter((c) => c.priority === maxPriority);

    const pick = tier[this.cursor % tier.length];
    this.cursor = (this.cursor + 1) % tier.length;
    return { ...pick };
  }

  reportSuccess(id: string): void {
    const proxy = this.getProxy(id);
    if (!proxy) return;
    proxy.requestsCount += 1;
    proxy.healthScore = Math.min(100, proxy.healthScore + HEALTH_BOOST_ON_SUCCESS);
  }

  reportFailure(id: string, now = Date.now()): void {
    const proxy = this.getProxy(id);
    if (!proxy) return;
    proxy.failureCount += 1;
    proxy.healthScore = Math.max(0, proxy.healthScore - HEALTH_DECAY_ON_FAILURE);
    proxy.lastFailedAt = new Date(now).toISOString();
  }

  private inCooldown(proxy: ProxyInstance, now: number): boolean {
    if (!proxy.lastFailedAt) return false;
    return now - Date.parse(proxy.lastFailedAt) < FAILURE_COOLDOWN_MS;
  }
}
