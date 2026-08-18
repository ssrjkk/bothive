/**
 * Builds ioredis connection options shared by every Redis client in the
 * project (BullMQ queues, pub/sub, memory store, leader election, rate
 * limiting, health keys). Everything is driven by environment variables so a
 * deployment can move from a single instance to a sentinel-managed (HA) Redis
 * without touching code:
 *
 *   REDIS_URL=redis://host:port[/db]
 *   REDIS_PASSWORD=...            optional auth password (also usable in URL)
 *   REDIS_DB=0                    optional logical DB number override
 *   REDIS_TLS=true                enable TLS for cloud managed Redis
 *   REDIS_SENTINELS=host1:26379,host2:26379   sentinel mode (HA/failover)
 *   REDIS_SENTINEL_NAME=mymaster              sentinel master name
 */
export interface RedisConnectionOptions {
  maxRetriesPerRequest: number | null;
  password?: string;
  db?: number;
  tls?: Record<string, unknown>;
  sentinels?: Array<{ host: string; port: number }>;
  name?: string;
  enableOfflineQueue?: boolean;
}

function parseSentinels(raw: string | undefined): Array<{ host: string; port: number }> {
  if (!raw) return [];
  const sentinels: Array<{ host: string; port: number }> = [];
  for (const part of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [host, portStr = '26379'] = part.split(':');
    const port = Number(portStr);
    if (host && Number.isInteger(port) && port > 0) {
      sentinels.push({ host, port });
    }
  }
  return sentinels;
}

export function redisConnectionOptions(): RedisConnectionOptions {
  const options: RedisConnectionOptions = {
    // BullMQ requires maxRetriesPerRequest: null (blocking pop commands).
    maxRetriesPerRequest: null,
  };
  if (process.env.REDIS_PASSWORD) {
    options.password = process.env.REDIS_PASSWORD;
  }
  const rawDb = process.env.REDIS_DB;
  if (rawDb !== undefined && rawDb.trim() !== '') {
    const db = Number(rawDb);
    if (Number.isInteger(db) && db >= 0) {
      options.db = db;
    }
  }
  if (process.env.REDIS_TLS === 'true') {
    options.tls = {};
  }
  const sentinels = parseSentinels(process.env.REDIS_SENTINELS);
  if (sentinels.length > 0) {
    options.sentinels = sentinels;
    options.name = process.env.REDIS_SENTINEL_NAME ?? 'mymaster';
  }
  return options;
}

/**
 * Options for command-only Redis clients (rate limiters, memory store, health
 * keys, pub/sub). These must fail fast when Redis is unavailable instead of
 * buffering commands forever: with `maxRetriesPerRequest: null` (required by
 * BullMQ's blocking connections) ioredis never rejects a queued command, so a
 * Redis outage would hang every `incr`/`get`/`set` — and with it the request
 * handlers or workers that await them. Command clients instead surface the
 * outage as a rejection so callers can degrade gracefully (in-memory fallback).
 */
export function redisCommandOptions(): RedisConnectionOptions {
  return {
    ...redisConnectionOptions(),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  };
}
