import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { parseWorkerHeartbeat } from '@bothive/core';
import { MetricsRegistry } from './registry.js';
import { redisConnection, getAllQueueMetrics } from '../services/queue.js';

export const metrics = new MetricsRegistry();

const HEALTH_KEY_PREFIX = 'bothive:health:';

const QUEUE_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed'] as const;

const WORKER_HEARTBEAT_PREFIX = 'worker:heartbeat:';
const WORKER_HEARTBEAT_TTL_MS = 30_000;
const WORKER_PLATFORMS = ['telegram', 'twitch', 'youtube', 'twitter', 'crypto'] as const;

const COUNTER_BASELINE_PREFIX = 'bothive:metrics:baseline:';
const COUNTER_BASELINE_TTL_S = 30 * 24 * 60 * 60;

// The API's shared Redis client is configured with maxRetriesPerRequest: null
// (a BullMQ requirement), so when Redis is unreachable ioredis does NOT reject
// commands — it queues them offline and retries indefinitely. A metrics scrape
// must never hang on that, so every Redis-backed collector races itself
// against this cap and degrades (reports workers down, skips the series)
// instead of letting the whole /metrics endpoint time out.
const REDIS_COLLECTION_TIMEOUT_MS = 1_000;

function withRedisTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`redis collection timed out after ${REDIS_COLLECTION_TIMEOUT_MS}ms`));
    }, REDIS_COLLECTION_TIMEOUT_MS);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface WorkerInstanceState {
  platform: string;
  instance: string;
  alive: boolean;
  concurrency: number;
  rss?: number;
  heapUsed?: number;
  heapTotal?: number;
  waitP50?: number;
  waitP95?: number;
  waitP99?: number;
  sandboxWorkers?: number;
}

interface BotHealthPayload {
  score?: number;
  status?: string;
  uptimeSeconds?: number;
  actionsSuccess?: number;
  actionsFailed?: number;
  reconnectAttempts?: number;
  scriptExecutions?: number;
  scriptErrors?: number;
}

/**
 * Workers publish process-lifetime cumulative counters in the health payload
 * (`actionsSuccess`, `scriptExecutions`, ...). Prometheus counters must be
 * monotonic and only grow, so the API converts those cumulative values into
 * the delta observed between scrapes. A drop means the worker process restarted
 * (its counters reset to 0); the new value is then counted from that baseline.
 * This makes `rate()`/`increase()` alert expressions valid.
 *
 * The per-series baselines are ALSO persisted to Redis so an API restart does
 * not forget them: without this, the first scrape after a restart would re-seed
 * the counter with the full lifetime cumulative, producing a false spike in
 * `rate()`/`increase()`. The in-memory map is the source of truth; Redis is a
 * durability mirror that is loaded once at startup.
 */
const lastBotCounterValues = new Map<string, number>();

function persistCounterBaseline(key: string, value: number): void {
  redisConnection
    .set(`${COUNTER_BASELINE_PREFIX}${key}`, String(value), 'EX', COUNTER_BASELINE_TTL_S)
    .catch(() => undefined);
}

async function loadCounterBaselines(): Promise<void> {
  try {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, found] = await redisConnection.scan(
        cursor,
        'MATCH',
        `${COUNTER_BASELINE_PREFIX}*`,
        'COUNT',
        200,
      );
      cursor = next;
      keys.push(...found);
    } while (cursor !== '0');

    if (keys.length === 0) return;
    const values = await redisConnection.mget(...keys);
    for (let i = 0; i < keys.length; i++) {
      const raw = values[i];
      if (raw === null) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const mapKey = keys[i].slice(COUNTER_BASELINE_PREFIX.length);
      if (mapKey.length > 0) lastBotCounterValues.set(mapKey, value);
    }
  } catch (err) {
    // Baseline load must never break the scrape; a missing baseline just means
    // the next scrape re-seeds that counter once.
    console.error('[metrics] failed to load counter baselines:', err);
  }
}

function incrementCounterFromCumulative(
  metric: string,
  labels: Record<string, string> | undefined,
  cumulative: number,
): void {
  if (!Number.isFinite(cumulative) || cumulative < 0) return;
  const key = `${metric}\u0000${JSON.stringify(labels ?? {})}`;
  const last = lastBotCounterValues.get(key);
  if (last === undefined) {
    // First scrape: seed the counter with the current cumulative so the series
    // is visible immediately; later scrapes only add the delta since here.
    lastBotCounterValues.set(key, cumulative);
    metrics.incrementCounter(metric, labels, Math.max(0, cumulative));
    persistCounterBaseline(key, cumulative);
    return;
  }
  lastBotCounterValues.set(key, cumulative);
  const delta = cumulative >= last ? cumulative - last : cumulative;
  if (delta > 0) metrics.incrementCounter(metric, labels, delta);
  if (delta > 0 || cumulative !== last) persistCounterBaseline(key, cumulative);
}

/**
 * Exposes BullMQ queue depths as `bothive_queue_jobs{queue,state}`
 * gauges. Redis being unavailable must never fail the scrape, so any error is
 * logged and skipped.
 */
async function collectQueueMetrics(): Promise<void> {
  try {
    const queues = await withRedisTimeout(getAllQueueMetrics());
    for (const queue of queues) {
      for (const state of QUEUE_STATES) {
        metrics.setGauge('bothive_queue_jobs', queue[state], {
          queue: queue.platform,
          state,
        });
      }
      // Aggregate depth of the platform's control queue, mirroring what the
      // worker sees behind its BullMQ consumer.
      metrics.setGauge('bothive_worker_queue_depth', queue.waiting + queue.active, {
        platform: queue.platform,
      });
    }
  } catch (err) {
    console.error('[metrics] queue metrics collection failed:', err);
  }
}

/**
 * Exposes per-platform worker liveness as `bothive_worker_up{platform}`
 * (1 = alive) from the heartbeat keys workers publish. Heartbeats are keyed
 * per INSTANCE (`worker:heartbeat:<platform>:<instance>`), so a scaled platform
 * publishes several keys; liveness is aggregated (any fresh instance = up),
 * while memory / wait percentiles / sandbox thread count are exposed per
 * instance so one ballooning replica cannot hide behind its healthy peers.
 * Redis being unavailable must never fail the scrape — it just reports every
 * worker down.
 */
async function collectWorkerHealth(): Promise<void> {
  const setDown = () => {
    for (const platform of WORKER_PLATFORMS) {
      metrics.setGauge('bothive_worker_up', 0, { platform });
    }
  };

  let states: WorkerInstanceState[];
  try {
    states = await withRedisTimeout(readWorkerHeartbeats());
  } catch (err) {
    console.error('[metrics] worker health collection failed:', err);
    setDown();
    return;
  }

  const byPlatform = new Map<string, WorkerInstanceState[]>();
  for (const state of states) {
    const list = byPlatform.get(state.platform) ?? [];
    list.push(state);
    byPlatform.set(state.platform, list);
  }

  for (const platform of WORKER_PLATFORMS) {
    const statesForPlatform = byPlatform.get(platform) ?? [];
    const alive = statesForPlatform.filter((s) => s.alive);
    metrics.setGauge('bothive_worker_up', alive.length > 0 ? 1 : 0, { platform });
    metrics.setGauge(
      'bothive_worker_concurrency_current',
      alive.reduce((sum, s) => sum + (s.concurrency ?? 0), 0),
      { platform },
    );
    // Per-instance series only for instances that actually report the value;
    // a dead/old worker emits nothing instead of a misleading 0 (which would
    // show up as a "zero memory" data point after a crash). The instance
    // label keeps replica series distinct under `--scale`.
    for (const s of alive) {
      if (typeof s.rss === 'number') {
        for (const type of ['rss', 'heapUsed', 'heapTotal'] as const) {
          const value = s[type];
          if (typeof value === 'number') {
            metrics.setGauge('bothive_worker_memory_bytes', value, {
              platform,
              instance: s.instance,
              type,
            });
          }
        }
      }
      if (typeof s.sandboxWorkers === 'number') {
        metrics.setGauge('bothive_worker_sandbox_workers', s.sandboxWorkers, {
          platform,
          instance: s.instance,
        });
      }
      const waits: Array<[string, number | undefined]> = [
        ['p50', s.waitP50],
        ['p95', s.waitP95],
        ['p99', s.waitP99],
      ];
      for (const [quantile, value] of waits) {
        if (typeof value === 'number') {
          metrics.setGauge('bothive_queue_wait_seconds', value, {
            platform,
            instance: s.instance,
            quantile,
          });
        }
      }
    }
  }
}

async function readWorkerHeartbeats(): Promise<WorkerInstanceState[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, found] = await redisConnection.scan(
      cursor,
      'MATCH',
      `${WORKER_HEARTBEAT_PREFIX}*`,
      'COUNT',
      100,
    );
    cursor = next;
    keys.push(...found);
  } while (cursor !== '0');

  if (keys.length === 0) return [];

  const rawValues = await redisConnection.mget(...keys);

  const now = Date.now();
  const states: WorkerInstanceState[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const suffix = key.slice(WORKER_HEARTBEAT_PREFIX.length);
    if (!suffix) continue;
    const separator = suffix.indexOf(':');
    const platform = separator === -1 ? suffix : suffix.slice(0, separator);
    const instance = separator === -1 ? 'legacy' : suffix.slice(separator + 1);
    const heartbeat = parseWorkerHeartbeat(rawValues[i] ?? '');
    states.push({
      platform,
      instance,
      alive: heartbeat.ts > 0 && now - heartbeat.ts < WORKER_HEARTBEAT_TTL_MS,
      concurrency: heartbeat.concurrency ?? 0,
      rss: heartbeat.rss,
      heapUsed: heartbeat.heapUsed,
      heapTotal: heartbeat.heapTotal,
      waitP50: heartbeat.waitP50,
      waitP95: heartbeat.waitP95,
      waitP99: heartbeat.waitP99,
      sandboxWorkers: heartbeat.sandboxWorkers,
    });
  }
  return states;
}

/**
 * Reads the per-bot health scores published by the workers
 * (`bothive:health:<botId>` = `{ score, status, updatedAt }`) and exposes them
 * as `bothive_bot_health_score` gauges. The process-lifetime activity counters
 * in the same payload are exposed as TRUE Prometheus counters via
 * `incrementCounterFromCumulative` (delta between scrapes), so
 * `bothive_bot_script_executions_total`, `bothive_bot_script_errors_total`,
 * `bothive_bot_reconnect_attempts_total` and `bothive_bot_actions_total` work
 * with `rate()`/`increase()` alerts. Redis being unavailable must never fail
 * the scrape, so any error is logged and skipped.
 */
async function collectBotHealth(): Promise<void> {
  let payloads: Array<{ botId: string; parsed: BotHealthPayload }>;
  try {
    payloads = await withRedisTimeout(readBotHealthPayloads());
  } catch (err) {
    console.error('[metrics] bot health collection failed:', err);
    return;
  }

  for (const { botId, parsed } of payloads) {
    const status = parsed.status ?? 'unknown';
    if (typeof parsed.score === 'number') {
      metrics.setGauge('bothive_bot_health_score', parsed.score, { bot_id: botId, status });
    }
    if (typeof parsed.uptimeSeconds === 'number') {
      metrics.setGauge('bothive_bot_uptime_seconds', parsed.uptimeSeconds, {
        bot_id: botId,
        status,
      });
    }
    if (typeof parsed.actionsSuccess === 'number') {
      incrementCounterFromCumulative(
        'bothive_bot_actions_total',
        { bot_id: botId, result: 'success' },
        parsed.actionsSuccess,
      );
    }
    if (typeof parsed.actionsFailed === 'number') {
      incrementCounterFromCumulative(
        'bothive_bot_actions_total',
        { bot_id: botId, result: 'failure' },
        parsed.actionsFailed,
      );
    }
    if (typeof parsed.reconnectAttempts === 'number') {
      incrementCounterFromCumulative(
        'bothive_bot_reconnect_attempts_total',
        { bot_id: botId },
        parsed.reconnectAttempts,
      );
    }
    if (typeof parsed.scriptExecutions === 'number') {
      incrementCounterFromCumulative(
        'bothive_bot_script_executions_total',
        { bot_id: botId },
        parsed.scriptExecutions,
      );
    }
    if (typeof parsed.scriptErrors === 'number') {
      incrementCounterFromCumulative(
        'bothive_bot_script_errors_total',
        { bot_id: botId },
        parsed.scriptErrors,
      );
    }
  }
}

async function readBotHealthPayloads(): Promise<
  Array<{ botId: string; parsed: BotHealthPayload }>
> {
  const pattern = `${HEALTH_KEY_PREFIX}*`;
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, found] = await redisConnection.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    keys.push(...found);
  } while (cursor !== '0');

  if (keys.length === 0) return [];

  const values = await redisConnection.mget(...keys);
  const payloads: Array<{ botId: string; parsed: BotHealthPayload }> = [];
  for (let i = 0; i < keys.length; i++) {
    const raw = values[i];
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw) as BotHealthPayload;
      const botId = keys[i].slice(HEALTH_KEY_PREFIX.length);
      if (botId.length === 0) continue;
      payloads.push({ botId, parsed });
    } catch {
      // skip malformed keys
    }
  }
  return payloads;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const maxLen = Math.max(bufA.length, bufB.length);
  if (maxLen === 0) return true;
  // Pad both buffers to equal length so timingSafeEqual doesn't throw.
  // Zeros fill the gap — they won't match any printable token character.
  const paddedA = Buffer.alloc(maxLen, 0);
  const paddedB = Buffer.alloc(maxLen, 0);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  // Combine byte-level and length comparisons into a single boolean.
  // Both sides were already evaluated (the length comparison is public; the
  // byte comparison runs the full constant-time timingSafeEqual regardless),
  // so the final AND leaks nothing about the secret bytes.
  const bytesMatch = timingSafeEqual(paddedA, paddedB);
  const sameLength = bufA.length === bufB.length;
  return bytesMatch && sameLength;
}

/**
 * Exposes the proxy pool as `bothive_proxy_health_score{proxy_id,type,priority}`
 * and `bothive_proxies_total{state}` so alerting can watch for unhealthy
 * outbound endpoints. DB errors are logged and skipped, never fail the scrape.
 */
async function collectProxyMetrics(
  prisma: typeof import('../services/prisma.js').prisma,
): Promise<void> {
  try {
    const proxies = await prisma.proxy.findMany({
      select: { id: true, type: true, priority: true, enabled: true, healthScore: true },
    });
    let enabled = 0;
    let unhealthy = 0;
    for (const proxy of proxies) {
      if (proxy.enabled) enabled += 1;
      if (!proxy.enabled) continue;
      metrics.setGauge('bothive_proxy_health_score', proxy.healthScore, {
        proxy_id: proxy.id,
        type: proxy.type,
        priority: String(proxy.priority),
      });
      if (proxy.healthScore === 0) unhealthy += 1;
    }
    metrics.setGauge('bothive_proxies_total', enabled, { state: 'enabled' });
    metrics.setGauge('bothive_proxies_total', unhealthy, { state: 'unhealthy' });
  } catch (err) {
    console.error('[metrics] proxy metrics collection failed:', err);
  }
}

export async function metricsPlugin(app: FastifyInstance): Promise<void> {
  // Restore per-series counter baselines before any scrape can observe deltas.
  void loadCounterBaselines();

  app.addHook('onRequest', async (request) => {
    request.metricsStart = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const start = request.metricsStart;
    if (start !== undefined) {
      const duration = Number(process.hrtime.bigint() - start) / 1e9;
      const route = request.routeOptions?.url;
      // Unmatched routes get a single fixed label instead of the raw URL, so
      // an attacker cannot grow the label cardinality (and memory) unboundedly.
      const routeLabel = route && route.length > 0 ? route : 'unmatched';
      const labels = {
        method: request.method,
        route: routeLabel,
        status: String(reply.statusCode),
      };
      metrics.incrementCounter('http_requests_total', labels);
      metrics.observe('http_request_duration_seconds', duration, labels);
      metrics.observe(
        'http_response_size_bytes',
        Number(reply.getHeader('content-length') ?? 0),
        labels,
      );
    }
  });

  app.get(
    '/metrics',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const open = process.env.METRICS_OPEN === 'true';
      const bearerToken = process.env.METRICS_TOKEN;

      if (!open) {
        const header = request.headers.authorization;
        if (bearerToken) {
          const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
          if (!token || !timingSafeEqualStr(token, bearerToken)) {
            return reply.status(401).send({
              success: false,
              error: { code: 'UNAUTHORIZED', message: 'Invalid or missing metrics token' },
            });
          }
        } else {
          try {
            await request.jwtVerify();
          } catch {
            return reply
              .status(401)
              .send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
          }
        }
      }

      const prisma = app.prisma;
      const collect = async () => {
        const [botsTotal, botsActive, botsError, accountsTotal] = await Promise.all([
          prisma.bot.count(),
          prisma.bot.count({ where: { status: 'running' } }),
          prisma.bot.count({ where: { status: 'error' } }),
          prisma.account.count(),
        ]);
        metrics.setGauge('bothive_bots_total', botsTotal);
        metrics.setGauge('bothive_bots_active', botsActive);
        metrics.setGauge('bothive_bots_error', botsError);
        metrics.setGauge('bothive_accounts_total', accountsTotal);
        await Promise.all([
          collectQueueMetrics(),
          collectWorkerHealth(),
          collectBotHealth(),
          collectProxyMetrics(prisma),
        ]);
      };

      const timeoutMs = Number(process.env.METRICS_TIMEOUT_MS ?? 3000);
      await Promise.race([
        collect(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('metrics collection timed out')), timeoutMs),
        ),
      ]);

      metrics.setGauge('nodejs_uptime_seconds', process.uptime());
      const memory = process.memoryUsage();
      metrics.setGauge('nodejs_heap_size_bytes', memory.heapUsed, { type: 'heapUsed' });
      metrics.setGauge('nodejs_heap_total_bytes', memory.heapTotal, { type: 'heapTotal' });
      metrics.setGauge('nodejs_rss_bytes', memory.rss, { type: 'rss' });

      reply.header('Content-Type', 'text/plain; charset=utf-8');
      return metrics.snapshot();
    },
  );
}
