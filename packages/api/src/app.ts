import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { config } from 'dotenv';
import { prisma } from './services/prisma.js';
import { botRoutes } from './routes/bots.js';
import { accountRoutes } from './routes/accounts.js';
import { authRoutes } from './routes/auth.js';
import { logRoutes } from './routes/logs.js';
import { statsRoutes } from './routes/stats.js';
import { queueRoutes } from './routes/queues.js';
import { scriptRoutes } from './routes/scripts.js';
import { bulkRoutes } from './routes/bulk.js';
import { webhookRoutes } from './routes/webhooks.js';
import { telegramRoutes } from './routes/telegram.js';
import { backupRoutes } from './routes/backup.js';
import { proxyRoutes } from './routes/proxies.js';
import { errorHandler } from './middleware/error-handler.js';
import { metricsPlugin } from './metrics/prometheus.js';
import { registerHandlers } from './commands/register.js';
import { logHub, getLogSubscriber } from './services/log-stream.js';
import {
  validateApiSecrets,
  RedisRateLimiter,
  parseWorkerHeartbeat,
  captureError,
} from '@bothive/core';
import { redisConnection } from './services/queue.js';
import { requireAuth } from './utils/auth-hook.js';
import { parseCookieHeader, TOKEN_COOKIE } from './utils/cookies.js';

const WORKER_PLATFORMS = ['telegram', 'twitch', 'youtube', 'twitter', 'crypto'];
const WORKER_HEARTBEAT_TTL_MS = 30_000;
const WORKER_HEARTBEAT_PREFIX = 'worker:heartbeat:';
const READY_REDIS_TIMEOUT_MS = 2000;
// Pin issuer/audience so a token minted for another audience (or a stale
// issuer) can never be replayed against this API.
const JWT_ISSUER = 'bothive';
const JWT_AUDIENCE = 'bothive-dashboard';

config();

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'X-XSS-Protection': '1; mode=block',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

function resolveCorsOrigin(): boolean | string[] {
  const raw = process.env.CORS_ORIGIN;
  if (raw === '*') return true;
  const origins = (raw ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : false;
}

const MAX_JSON_DEPTH = 20;

function jsonDepth(value: unknown, depth = 0): number {
  if (depth >= MAX_JSON_DEPTH) return depth + 1;
  if (Array.isArray(value)) {
    let max = depth + 1;
    for (const item of value) max = Math.max(max, jsonDepth(item, depth + 1));
    return max;
  }
  if (value !== null && typeof value === 'object') {
    let max = depth + 1;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      max = Math.max(max, jsonDepth((value as Record<string, unknown>)[key], depth + 1));
    }
    return max;
  }
  return depth;
}

export async function buildApp() {
  // HTTP/2 support (opt-in via API_HTTP2=true, off by default). This starts a
  // cleartext h2c server: it only accepts h2c prior-knowledge clients, so it is
  // NOT safe to enable directly behind the nginx proxy or for HTTP/1.1
  // healthchecks (allowHTTP1 HTTP/1.x fallback only works on TLS ALPN servers,
  // i.e. http2.createSecureServer). Enable it only when a TLS-terminating
  // load balancer speaks h2c to the API. The options object is typed as the
  // plain HTTP/1.1 server (Fastify's overloads would otherwise infer
  // Http2Server and break every handler signature); at runtime Fastify reads
  // `http2` and creates an h2c-capable server.
  const http2Enabled = process.env.API_HTTP2 === 'true';
  const serverOptions: FastifyServerOptions = {
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Only trust the proxy chain when explicitly configured. With trustProxy
    // off, request.ip is the real socket address and X-Forwarded-For cannot be
    // used to spoof rate-limit keys or client IPs.
    trustProxy: process.env.TRUST_PROXY === 'true',
    bodyLimit: 1024 * 1024,
    ...(http2Enabled ? { http2: true, allowHTTP1: true } : {}),
  };
  const app = Fastify(serverOptions);

  await app.register(cors, { origin: resolveCorsOrigin() });
  // gzip/deflate/brotli compression for JSON and text responses over ~1 kB.
  // Skipped automatically for websocket upgrades and requests without an
  // Accept-Encoding header. Websocket log streaming stays uncompressed.
  await app.register(compress, { global: true });
  validateApiSecrets();
  const jwtSecret = process.env.JWT_SECRET!;
  await app.register(jwt, {
    secret: jwtSecret,
    sign: { iss: JWT_ISSUER, aud: JWT_AUDIENCE },
    verify: { allowedIss: [JWT_ISSUER], allowedAud: [JWT_AUDIENCE] },
  });
  await app.register(websocket);

  // OpenAPI 3 spec generated from the registered routes (dynamic mode) plus a
  // Swagger UI at /api/docs. Registered before the route plugins below so every
  // route is captured. The JSON spec lives at /api/docs/json and can be fed
  // straight into client/SDK generators.
  await app.register(swagger, {
    mode: 'dynamic',
    openapi: {
      info: {
        title: 'BotHive API',
        description:
          'REST + WebSocket API for BotHive — multi-bot orchestrator for Telegram, Twitch, YouTube and Twitter.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });
  await app.register(swaggerUI, {
    routePrefix: '/api/docs',
    // The spec enumerates every route, so gate the whole docs surface (UI,
    // JSON and YAML) behind the same auth as the API it documents.
    uiHooks: { onRequest: requireAuth },
  });

  // Reject deeply nested JSON bodies to avoid stack-exhaustion on parse and
  // pathological serialization of attacker-controlled payloads.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const parsed = JSON.parse(body as string);
      if (jsonDepth(parsed) > MAX_JSON_DEPTH) {
        const err = new Error(`Request body JSON exceeds maximum depth of ${MAX_JSON_DEPTH}`);
        (err as Error & { statusCode: number }).statusCode = 400;
        done(err, undefined);
        return;
      }
      done(null, parsed);
    } catch (err) {
      const parseError = err as Error;
      (parseError as Error & { statusCode: number }).statusCode = 400;
      done(parseError, undefined);
    }
  });

  app.decorate('prisma', prisma);
  app.decorateRequest('prisma', { getter: () => prisma });

  // Coarse per-IP guard over all /api routes. Auth endpoints keep their own
  // stricter limits; this only stops burst abuse. Tune via API_RATE_LIMIT.
  const apiLimiter = new RedisRateLimiter(
    redisConnection,
    'rl:api',
    Number(process.env.API_RATE_LIMIT ?? 300),
    60_000,
  );
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    // The Telegram webhook receiver is gated by its own token verification;
    // a busy bot can legitimately exceed the per-IP dashboard budget, and a
    // 429 there would make Telegram retry valid updates.
    if (request.url.startsWith('/api/telegram/webhook/')) return;
    if (!(await apiLimiter.check(request.ip))) {
      reply
        .status(429)
        .send({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    }
  });

  // Support httpOnly cookie auth: translate the cookie into an Authorization
  // header so the rest of the app keeps working unchanged. Explicit Bearer
  // headers always win.
  app.addHook('onRequest', async (request) => {
    if (request.headers.authorization) return;
    const cookies = parseCookieHeader(request.headers.cookie as string | undefined);
    if (cookies[TOKEN_COOKIE]) {
      request.headers.authorization = `Bearer ${cookies[TOKEN_COOKIE]}`;
    }
  });

  app.setErrorHandler(errorHandler);

  // Report handled-and-unhandled request errors to Sentry (no-op without
  // SENTRY_DSN). The error handler already answers the client; this only
  // captures telemetry with request context for triage.
  app.addHook('onError', async (request, reply, error) => {
    captureError(error, {
      method: request.method,
      route: request.routeOptions?.url ?? 'unmatched',
      path: request.url,
      status: String(reply.statusCode),
      userId: (request.user as { id?: string } | undefined)?.id,
    });
  });

  app.addHook('onSend', async (request, reply) => {
    // Swagger UI renders via inline scripts/styles that the strict CSP below
    // would block; it is a read-only developer tool, so exempt its routes.
    if (request.url.startsWith('/api/docs')) return;
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(name, value);
    }
  });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  registerHandlers(prisma);

  app.get('/health', async () => ({
    status: 'ok',
    name: 'BotHive',
    author: 'ssrjkk',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }));

  app.get('/health/ready', async (_request, reply) => {
    let database: 'connected' | 'unavailable' = 'connected';
    let redis: 'connected' | 'unavailable' = 'connected';

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'unavailable';
    }

    // Redis is a hard dependency (queues, rate limits, live logs); a readiness
    // probe that ignores it can route traffic to a half-broken API.
    try {
      await Promise.race([
        redisConnection.ping(),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('redis ping timed out')),
            READY_REDIS_TIMEOUT_MS,
          );
          timer.unref();
        }),
      ]);
    } catch {
      redis = 'unavailable';
    }

    if (database !== 'connected' || redis !== 'connected') {
      reply.status(503);
    }
    return {
      status: database === 'connected' && redis === 'connected' ? 'ok' : 'unavailable',
      database,
      redis,
    };
  });

  // Per-platform worker liveness, from the heartbeat keys workers publish to
  // Redis. A worker is "alive" if any instance's heartbeat is fresh enough
  // (heartbeats are keyed per instance under `worker:heartbeat:<platform>:<id>`,
  // so a scaled platform publishes several keys and a single surviving replica
  // still counts as up).
  app.get('/api/health/workers', { onRequest: requireAuth }, async () => {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redisConnection.scan(
        cursor,
        'MATCH',
        `${WORKER_HEARTBEAT_PREFIX}*`,
        'COUNT',
        100,
      );
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');

    if (keys.length === 0) {
      return {
        success: true,
        data: WORKER_PLATFORMS.map((platform) => ({
          platform,
          alive: false,
          lastSeen: null,
        })),
      };
    }

    const rawValues = await redisConnection.mget(...keys);

    const now = Date.now();
    const byPlatform = new Map<
      string,
      { alive: boolean; lastSeen: number; concurrency: number; version: string | null }
    >();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const suffix = key.slice(WORKER_HEARTBEAT_PREFIX.length);
      if (!suffix) continue;
      const platform = suffix.includes(':') ? suffix.split(':')[0] : suffix;
      const heartbeat = parseWorkerHeartbeat(rawValues[i] ?? '');
      const lastSeen = heartbeat.ts;
      const current = byPlatform.get(platform) ?? {
        alive: false,
        lastSeen: 0,
        concurrency: 0,
        version: null,
      };
      if (lastSeen > current.lastSeen) current.lastSeen = lastSeen;
      if (lastSeen > 0 && now - lastSeen < WORKER_HEARTBEAT_TTL_MS) current.alive = true;
      current.concurrency += heartbeat.concurrency ?? 0;
      if (heartbeat.version && current.version === null) current.version = heartbeat.version;
      byPlatform.set(platform, current);
    }
    return {
      success: true,
      data: WORKER_PLATFORMS.map((platform) => {
        const state = byPlatform.get(platform);
        return state
          ? {
              platform,
              alive: state.alive,
              lastSeen: state.lastSeen > 0 ? new Date(state.lastSeen).toISOString() : null,
              concurrency: state.concurrency,
              version: state.version,
            }
          : { platform, alive: false, lastSeen: null };
      }),
    };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(accountRoutes, { prefix: '/api/accounts' });
  await app.register(botRoutes, { prefix: '/api/bots' });
  await app.register(bulkRoutes, { prefix: '/api/bulk' });
  await app.register(logRoutes, { prefix: '/api/logs' });
  await app.register(statsRoutes, { prefix: '/api/stats' });
  await app.register(queueRoutes, { prefix: '/api/queues' });
  await app.register(scriptRoutes, { prefix: '/api/scripts' });
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });
  await app.register(telegramRoutes, { prefix: '/api/telegram' });
  await app.register(backupRoutes, { prefix: '/api/backup' });
  await app.register(proxyRoutes, { prefix: '/api/proxies' });
  await metricsPlugin(app);

  app.get('/ws/logs', { websocket: true }, async (socket, req) => {
    const header = req.headers['sec-websocket-protocol'];
    const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
    const protocol = raw
      .split(',')
      .map((s) => s.trim())
      .find((p) => p.startsWith('bothive.'));
    const protocolToken = protocol?.slice('bothive.'.length);

    // Fall back to the httpOnly cookie so the dashboard never exposes the
    // token to JavaScript.
    const cookieToken = parseCookieHeader(req.headers.cookie as string | undefined)[TOKEN_COOKIE];
    const token = protocolToken || cookieToken;

    if (!token) {
      socket.send(JSON.stringify({ type: 'error', data: { message: 'Missing token' } }));
      socket.close();
      return;
    }
    let payload: { id: string };
    try {
      payload = app.jwt.verify(token) as { id: string };
    } catch {
      socket.send(JSON.stringify({ type: 'error', data: { message: 'Invalid token' } }));
      socket.close();
      return;
    }

    // Mirror requireAuth's DB re-fetch: a token for a deleted user must not
    // keep the log stream alive until the JWT expires.
    const user = await req.prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true },
    });
    if (!user) {
      socket.send(JSON.stringify({ type: 'error', data: { message: 'Unauthorized' } }));
      socket.close();
      return;
    }

    void getLogSubscriber();
    logHub.add(socket);
    socket.on('close', () => logHub.remove(socket));
  });

  return app;
}
