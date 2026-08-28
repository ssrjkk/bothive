import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';

const PREFIX = 'bothive:mem';

const redis = new Redis(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
  redisConnectionOptions(),
);

// Without an 'error' listener ioredis emits an uncaught 'error' event on a
// dropped connection and would crash the whole API process.
redis.on('error', (err) => {
  console.error('[api] memory Redis error:', err?.message ?? err);
});

export interface MemoryEntry {
  key: string;
  value: unknown;
  ttl?: number;
  createdAt: string;
  expiresAt?: string;
}

async function scanByPattern(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    keys.push(...found);
  } while (cursor !== '0');
  return keys;
}

async function scanKeys(botId: string): Promise<string[]> {
  return scanByPattern(`${PREFIX}:${botId}:*`);
}

export async function getBotMemory(botId: string, maxKeys = 1000): Promise<MemoryEntry[]> {
  const keys = await scanKeys(botId);
  if (keys.length === 0) return [];

  // Cap the number of entries returned to bound response size / latency.
  const keysToFetch = keys.slice(0, maxKeys);
  const values = await redis.mget(...keysToFetch);
  const entries: MemoryEntry[] = [];
  for (let i = 0; i < keysToFetch.length; i++) {
    const raw = values[i];
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw) as MemoryEntry;
      if (parsed && typeof parsed.key === 'string') {
        entries.push(parsed);
      }
    } catch {
      entries.push({
        key: keysToFetch[i].slice(PREFIX.length + 1),
        value: raw,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

export async function deleteBotMemoryKey(botId: string, key: string): Promise<boolean> {
  const deleted = await redis.del(`${PREFIX}:${botId}:${key}`);
  return deleted > 0;
}

export async function clearBotMemory(botId: string): Promise<number> {
  const keys = await scanKeys(botId);
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}

const CRYPTO_POSITIONS_PREFIX = 'bothive:crypto:positions:';
const CRYPTO_DAILY_PREFIX = 'bothive:crypto:daily:';
const CRYPTO_LIVE_PREFIX = 'bothive:crypto:live:';

async function scanAndDelete(pattern: string): Promise<number> {
  const keys = await scanByPattern(pattern);
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}

/**
 * Deletes all Redis state belonging to a bot that is being removed: bot memory
 * keys, dry-run positions, the live trade ledger and the daily-spend counter.
 * The keys would otherwise linger after the bot row is gone (dry positions
 * and the live ledger carry no TTL).
 */
export async function deleteBotRuntimeState(botId: string): Promise<number> {
  let deleted = await clearBotMemory(botId);
  deleted += await scanAndDelete(`${CRYPTO_DAILY_PREFIX}${botId}:*`);
  deleted += await redis.del(`${CRYPTO_POSITIONS_PREFIX}${botId}`);
  deleted += await redis.del(`${CRYPTO_LIVE_PREFIX}${botId}`);
  return deleted;
}

export async function disconnectMemory(): Promise<void> {
  await redis.quit().catch(() => undefined);
}

export interface CryptoPosition {
  symbol: string;
  quantity: number;
  avgEntry: number | null;
}

export interface CryptoOpenOrder {
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  price: number | null;
  quantity: number;
  placedAt: number;
}

export interface CryptoState {
  tradeMode: 'live' | 'dry' | 'none';
  positions: CryptoPosition[];
  realizedPnl: number | null;
  openOrders: CryptoOpenOrder[];
  /** Total spend recorded today in USDT (sum over the 48h-TTL daily keys). */
  dailySpendUsdt: number;
  updatedAt: string | null;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Reads the bot's crypto trading state from Redis: the live ledger snapshot
 * (positions with weighted-average entries, realized PnL, open orders) or the
 * dry-run positions, plus today's daily-spend counter. All values are
 * sanitized — Redis content is treated as untrusted input for the dashboard.
 * A Redis outage degrades to an empty state instead of failing the request.
 */
export async function getCryptoState(botId: string): Promise<CryptoState> {
  const empty: CryptoState = {
    tradeMode: 'none',
    positions: [],
    realizedPnl: null,
    openOrders: [],
    dailySpendUsdt: 0,
    updatedAt: null,
  };
  try {
    const [rawLive, rawPositions, dailyKeys] = await Promise.all([
      redis.get(`${CRYPTO_LIVE_PREFIX}${botId}`),
      redis.get(`${CRYPTO_POSITIONS_PREFIX}${botId}`),
      scanByPattern(`${CRYPTO_DAILY_PREFIX}${botId}:*`),
    ]);

    let dailySpendUsdt = 0;
    if (dailyKeys.length > 0) {
      const cents = await redis.mget(...dailyKeys);
      for (const value of cents) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) dailySpendUsdt += parsed / 100;
      }
    }

    if (rawLive) {
      const snapshot = JSON.parse(rawLive) as {
        positions?: Record<string, unknown>;
        avgEntry?: Record<string, unknown>;
        realizedPnl?: unknown;
        openOrders?: Record<string, unknown>;
        updatedAt?: unknown;
      };
      const avgEntry =
        snapshot.avgEntry && typeof snapshot.avgEntry === 'object'
          ? (snapshot.avgEntry as Record<string, unknown>)
          : {};
      const positions: CryptoPosition[] = [];
      if (snapshot.positions && typeof snapshot.positions === 'object') {
        for (const [symbol, qty] of Object.entries(snapshot.positions as Record<string, unknown>)) {
          if (!finite(qty) || qty <= 0) continue;
          const entry = avgEntry[symbol];
          positions.push({
            symbol: symbol.toUpperCase(),
            quantity: qty,
            avgEntry: finite(entry) && entry > 0 ? entry : null,
          });
        }
      }
      positions.sort((a, b) => a.symbol.localeCompare(b.symbol));

      const openOrders: CryptoOpenOrder[] = [];
      if (snapshot.openOrders && typeof snapshot.openOrders === 'object') {
        for (const order of Object.values(snapshot.openOrders as Record<string, unknown>)) {
          if (!order || typeof order !== 'object') continue;
          const o = order as Record<string, unknown>;
          if (typeof o.clientOrderId !== 'string' || o.clientOrderId.length === 0) continue;
          openOrders.push({
            clientOrderId: o.clientOrderId,
            symbol: String(o.symbol ?? '').toUpperCase(),
            side: o.side === 'sell' ? 'sell' : 'buy',
            type: o.type === 'limit' ? 'limit' : 'market',
            price: finite(o.price) && o.price > 0 ? o.price : null,
            quantity: finite(o.quantity) && o.quantity > 0 ? o.quantity : 0,
            placedAt: finite(o.placedAt) ? o.placedAt : 0,
          });
        }
      }
      openOrders.sort((a, b) => a.placedAt - b.placedAt);

      return {
        tradeMode: 'live',
        positions,
        realizedPnl: finite(snapshot.realizedPnl) ? snapshot.realizedPnl : 0,
        openOrders,
        dailySpendUsdt,
        updatedAt: finite(snapshot.updatedAt) ? new Date(snapshot.updatedAt).toISOString() : null,
      };
    }

    if (rawPositions) {
      const parsed = JSON.parse(rawPositions) as Record<string, unknown>;
      const positions: CryptoPosition[] = [];
      for (const [symbol, qty] of Object.entries(parsed)) {
        if (!finite(qty) || qty <= 0) continue;
        positions.push({ symbol: symbol.toUpperCase(), quantity: qty, avgEntry: null });
      }
      positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
      return { ...empty, tradeMode: 'dry', positions, dailySpendUsdt };
    }

    return { ...empty, dailySpendUsdt };
  } catch (err) {
    console.error(`[api] Crypto state read failed for ${botId}:`, err);
    return empty;
  }
}
