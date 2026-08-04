import type { FastifyInstance } from 'fastify';
import { MetricsRegistry } from './registry.js';

export const metrics = new MetricsRegistry();

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
