import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
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
import { backupRoutes } from './routes/backup.js';
import { errorHandler } from './middleware/error-handler.js';
import { metricsPlugin } from './metrics/prometheus.js';
import { registerHandlers } from './commands/register.js';
import { logHub, getLogSubscriber } from './services/log-stream.js';
import { validateApiSecrets, RedisRateLimiter } from '@bothive/core';
import { redisConnection } from './services/queue.js';
import { parseCookieHeader, TOKEN_COOKIE } from './utils/cookies.js';

config();

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'X-XSS-Protection': '1; mode=block',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
};

function resolveCorsOrigin(): boolean | string[] {
  const raw = process.env.CORS_ORIGIN;
  if (raw === '*') return true;
  const origins = (raw ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((s) => s.trim()).filter(Boolean);
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
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Only trust the proxy chain when explicitly configured. With trustProxy
    // off, request.ip is the real socket address and X-Forwarded-For cannot be
    // used to spoof rate-limit keys or client IPs.
    trustProxy: process.env.TRUST_PROXY === 'true',
    bodyLimit: 1024 * 1024,
  });

  await app.register(cors, { origin: resolveCorsOrigin() });
  validateApiSecrets();
  const jwtSecret = process.env.JWT_SECRET!;
  await app.register(jwt, { secret: jwtSecret });
  await app.register(websocket);

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
  const apiLimiter = new RedisRateLimiter(redisConnection, 'rl:api', Number(process.env.API_RATE_LIMIT ?? 300), 60_000);
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (!(await apiLimiter.check(request.ip))) {
      reply.status(429).send({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
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

  app.addHook('onSend', async (_request, reply) => {
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

  app.get('/health/ready', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'connected' };
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
  await app.register(backupRoutes, { prefix: '/api/backup' });
  await app.register(metricsPlugin);

  app.get('/ws/logs', { websocket: true }, (socket, req) => {
    const header = req.headers['sec-websocket-protocol'];
    const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
    const protocol = raw.split(',').map((s) => s.trim()).find((p) => p.startsWith('bothive.'));
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
    try {
      app.jwt.verify(token);
    } catch {
      socket.send(JSON.stringify({ type: 'error', data: { message: 'Invalid token' } }));
      socket.close();
      return;
    }

    void getLogSubscriber();
    logHub.add(socket);
    socket.on('close', () => logHub.remove(socket));
  });

  return app;
}
