import type { FastifyInstance } from 'fastify';
import { parseWorkerHeartbeat } from '@bothive/core';
import { MetricsRegistry } from './registry.js';
import { redisConnection, getAllQueueMetrics } from '../services/queue.js';

export const metrics = new MetricsRegistry();

const HEALTH_KEY_PREFIX = 'bothive:health:';

const QUEUE_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed'] as const;

const WORKER_HEARTBEAT_PREFIX = 'worker:heartbeat:';
const WORKER_HEARTBEAT_TTL_MS = 30_000;
const WORKER_PLATFORMS = ['telegram', 'twitch', 'youtube', 'twitter'] as const;

/**
 * Exposes BullMQ queue depths as `bothive_queue_jobs_total{queue,state}`
 * gauges. Redis being unavailable must never fail the scrape, so any error is
 * logged and skipped.
 */
async function collectQueueMetrics(): Promise<void> {
  try {
    const queues = await getAllQueueMetrics();
    for (const queue of queues) {
      for (const state of QUEUE_STATES) {
        metrics.setGauge('bothive_queue_jobs_total', queue[state], { queue: queue.platform, state });
      }
      // Aggregate depth of the platform's control queue, mirroring what the
      // worker sees behind its BullMQ consumer.
      metrics.setGauge('bothive_worker_queue_depth', queue.waiting + queue.active, { platform: queue.platform });
    }
  } catch (err) {
    console.error('[metrics] queue metrics collection failed:', err);
  }
}

/**
 * Exposes per-platform worker liveness as `bothive_worker_up{platform}`
 * (1 = alive) from the heartbeat keys workers publish. Redis being unavailable
 * must never fail the scrape — it just reports every worker down.
 */
async function collectWorkerHealth(): Promise<void> {
  const setDown = () => {
    for (const platform of WORKER_PLATFORMS) {
      metrics.setGauge('bothive_worker_up', 0, { platform });
      metrics.setGauge('bothive_worker_concurrency_current', 0, { platform });
    }
  };
  try {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, found] = await redisConnection.scan(cursor, 'MATCH', `${WORKER_HEARTBEAT_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      keys.push(...found);
    } while (cursor !== '0');

    const now = Date.now();
    const byPlatform = new Map<string, { alive: boolean; concurrency: number }>();
    for (const key of keys) {
      const platform = key.slice(WORKER_HEARTBEAT_PREFIX.length);
      const raw = await redisConnection.get(key);
      const heartbeat = parseWorkerHeartbeat(raw ?? '');
      byPlatform.set(platform, {
        alive: heartbeat.ts > 0 && now - heartbeat.ts < WORKER_HEARTBEAT_TTL_MS,
        concurrency: heartbeat.concurrency ?? 0,
      });
    }
    for (const platform of WORKER_PLATFORMS) {
      const state = byPlatform.get(platform);
      metrics.setGauge('bothive_worker_up', state?.alive === true ? 1 : 0, { platform });
      metrics.setGauge('bothive_worker_concurrency_current', state?.alive === true ? state.concurrency : 0, { platform });
    }
  } catch (err) {
    console.error('[metrics] worker health collection failed:', err);
    setDown();
  }
}

/**
 * Reads the per-bot health scores published by the workers
 * (`bothive:health:<botId>` = `{ score, status, updatedAt }`) and exposes them
 * as `bothive_bot_health_score` gauges. Redis being unavailable must never fail
 * the scrape, so any error is logged and skipped.
 */
async function collectBotHealth(): Promise<void> {
  try {
    const pattern = `${HEALTH_KEY_PREFIX}*`;
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, found] = await redisConnection.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      keys.push(...found);
    } while (cursor !== '0');

    if (keys.length === 0) return;

    const values = await redisConnection.mget(...keys);
    for (let i = 0; i < keys.length; i++) {
      const raw = values[i];
      if (raw === null) continue;
      try {
        const parsed = JSON.parse(raw) as {
          score?: number;
          status?: string;
          uptimeSeconds?: number;
          actionsSuccess?: number;
          actionsFailed?: number;
          reconnectAttempts?: number;
          scriptExecutions?: number;
        };
        const botId = keys[i].slice(HEALTH_KEY_PREFIX.length);
        if (botId.length === 0) continue;
        const status = parsed.status ?? 'unknown';
        if (typeof parsed.score === 'number') {
          metrics.setGauge('bothive_bot_health_score', parsed.score, { bot_id: botId, status });
        }
        if (typeof parsed.uptimeSeconds === 'number') {
          metrics.setGauge('bothive_bot_uptime_seconds', parsed.uptimeSeconds, { bot_id: botId, status });
        }
        if (typeof parsed.actionsSuccess === 'number') {
          metrics.setGauge('bothive_bot_actions_total', parsed.actionsSuccess, { bot_id: botId, result: 'success' });
        }
        if (typeof parsed.actionsFailed === 'number') {
          metrics.setGauge('bothive_bot_actions_total', parsed.actionsFailed, { bot_id: botId, result: 'failure' });
        }
        if (typeof parsed.reconnectAttempts === 'number') {
          metrics.setGauge('bothive_bot_reconnect_attempts_total', parsed.reconnectAttempts, { bot_id: botId });
        }
        if (typeof parsed.scriptExecutions === 'number') {
          metrics.setGauge('bothive_bot_script_executions_total', parsed.scriptExecutions, { bot_id: botId });
        }
      } catch {
        // skip malformed keys
      }
    }
  } catch (err) {
    console.error('[metrics] bot health collection failed:', err);
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Exposes the proxy pool as `bothive_proxy_health_score{proxy_id,type,priority}`
 * and `bothive_proxies_total{state}` so alerting can watch for unhealthy
 * outbound endpoints. DB errors are logged and skipped, never fail the scrape.
 */
async function collectProxyMetrics(prisma: typeof import('../services/prisma.js').prisma): Promise<void> {
  try {
    const proxies = await prisma.proxy.findMany({ select: { id: true, type: true, priority: true, enabled: true, healthScore: true } });
    let enabled = 0;
    let unhealthy = 0;
    for (const proxy of proxies) {
      metrics.setGauge('bothive_proxy_health_score', proxy.healthScore, {
        proxy_id: proxy.id,
        type: proxy.type,
        priority: String(proxy.priority),
      });
      if (proxy.enabled) enabled += 1;
      if (proxy.enabled && proxy.healthScore === 0) unhealthy += 1;
    }
    metrics.setGauge('bothive_proxies_total', enabled, { state: 'enabled' });
    metrics.setGauge('bothive_proxies_total', unhealthy, { state: 'unhealthy' });
  } catch (err) {
    console.error('[metrics] proxy metrics collection failed:', err);
  }
}

export async function metricsPlugin(app: FastifyInstance): Promise<void> {
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
      const labels = { method: request.method, route: routeLabel, status: String(reply.statusCode) };
      metrics.incrementCounter('http_requests_total', labels);
      metrics.observe('http_request_duration_seconds', duration, labels);
      metrics.observe('http_response_size_bytes', Number(reply.getHeader('content-length') ?? 0), labels);
    }
  });

  app.get('/metrics', async (request, reply) => {
    const open = process.env.METRICS_OPEN === 'true';
    const bearerToken = process.env.METRICS_TOKEN;

    if (!open) {
      const header = request.headers.authorization;
      if (bearerToken) {
        const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
        if (!token || !timingSafeEqualStr(token, bearerToken)) {
          return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing metrics token' } });
        }
      } else {
        try {
          await request.jwtVerify();
        } catch {
          return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
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
      await collectQueueMetrics();
      await collectWorkerHealth();
      await collectBotHealth();
      await collectProxyMetrics(prisma);
    };

    const timeoutMs = Number(process.env.METRICS_TIMEOUT_MS ?? 3000);
    await Promise.race([
      collect(),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('metrics collection timed out')), timeoutMs)),
    ]);

    metrics.setGauge('nodejs_uptime_seconds', process.uptime());
    const memory = process.memoryUsage();
    metrics.setGauge('nodejs_heap_size_bytes', memory.heapUsed, { type: 'heapUsed' });
    metrics.setGauge('nodejs_heap_total_bytes', memory.heapTotal, { type: 'heapTotal' });
    metrics.setGauge('nodejs_rss_bytes', memory.rss, { type: 'rss' });

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return metrics.snapshot();
  });
}
