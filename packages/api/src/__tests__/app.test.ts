import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ok, err, AppError, commandBus, encryptCredential, testProxy } from '@bothive/core';
import {
  enqueueConnect,
  enqueueDisconnect,
  getQueue,
  redisConnection,
  getAllQueueMetrics,
} from '../services/queue.js';
import {
  getBotMemory,
  clearBotMemory,
  deleteBotMemoryKey,
  deleteBotRuntimeState,
  getCryptoState,
} from '../services/memory.js';
import { notifyScriptsChanged } from '../services/script-events.js';
import type { MockDb } from './helpers/mock-db.js';

const holder = vi.hoisted(() => ({ db: null as unknown as MockDb }));

vi.mock('../services/prisma.js', async () => {
  const { createMockDb } = await import('./helpers/mock-db.js');
  const db = createMockDb();
  holder.db = db;
  return { prisma: db.prisma };
});

vi.mock('../services/queue.js', () => ({
  enqueueConnect: vi.fn(async () => ({ id: 'job' })),
  enqueueDisconnect: vi.fn(async () => ({ id: 'job' })),
  enqueueAction: vi.fn(async () => ({ id: 'job' })),
  getQueue: vi.fn(() => ({ add: vi.fn(async () => ({ id: 'job' })) })),
  getQueueMetrics: vi.fn(async () => ({
    platform: 'x',
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
  })),
  getAllQueueMetrics: vi.fn(async () => []),
  getFailedJobs: vi.fn(async () => []),
  redisConnection: {
    publish: vi.fn(),
    disconnect: vi.fn(),
    scan: vi.fn(async () => ['0', []]),
    get: vi.fn(async () => null),
    mget: vi.fn(async () => []),
    set: vi.fn(async () => 'OK'),
    ping: vi.fn(async () => 'PONG'),
  },
}));

vi.mock('../services/memory.js', () => ({
  getBotMemory: vi.fn(async () => []),
  clearBotMemory: vi.fn(async () => 0),
  deleteBotMemoryKey: vi.fn(async () => false),
  deleteBotRuntimeState: vi.fn(async () => 0),
  getCryptoState: vi.fn(async () => ({
    tradeMode: 'none',
    positions: [],
    realizedPnl: null,
    openOrders: [],
    dailySpendUsdt: 0,
    updatedAt: null,
  })),
}));

vi.mock('../services/script-events.js', () => ({
  notifyScriptsChanged: vi.fn(),
}));

vi.mock('../services/log-stream.js', () => ({
  logHub: { add: vi.fn(), remove: vi.fn() },
  getLogSubscriber: vi.fn(async () => undefined),
}));

// testProxy does real network I/O; keep the proxy endpoints deterministic in
// tests while leaving the rest of the core module untouched.
vi.mock('@bothive/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bothive/core')>();
  return { ...mod, testProxy: vi.fn(async () => true) };
});

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { hashPassword } from '../utils/password.js';

// Pre-compute once so seeding a user with a verifiable password does not need
// an async call at every seed site.
const seededHash = await hashPassword('password123');

let app: FastifyInstance;
const dispatchSpy = vi.spyOn(commandBus, 'dispatch');

const signToken = (id: string, email = 'admin@bothive.test') =>
  app.jwt.sign({ id, email, role: 'admin' });

const seedUser = () =>
  holder.db.seed('user', [
    {
      id: 'u1',
      email: 'admin@bothive.test',
      name: 'Admin',
      role: 'admin',
      passwordHash: seededHash,
    },
  ]);

const seedBot = (id: string, platform = 'twitch', extra: Record<string, unknown> = {}) =>
  holder.db.seed('bot', [
    { id, name: `Bot ${id}`, platform, accountId: 'a1', status: 'running', config: {}, ...extra },
  ]);

const seedAccount = () =>
  holder.db.seed('account', [
    {
      id: 'a1',
      name: 'Acc',
      platform: 'twitch',
      token: 'super-secret-token-value',
      clientId: 'client-secret',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-0123456789abcdef';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  app = await buildApp();
  dispatchSpy.mockResolvedValue(ok({}));
});

beforeEach(() => {
  holder.db.reset();
  vi.clearAllMocks();
  dispatchSpy.mockResolvedValue(ok({}));
});

afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
});

/**
 * Auth helper: seeds the admin user and returns a freshly-signed bearer token.
 * Re-seeding is required because requireAuth now re-fetches the user from the
 * database instead of trusting the role claim embedded in the JWT.
 */
const authed = (headers: Record<string, string> = {}) => {
  seedUser();
  return { headers: { authorization: `Bearer ${signToken('u1')}`, ...headers } };
};

describe('infrastructure', () => {
  it('serves health without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeUndefined();
    expect(res.json().name).toBe('BotHive');
  });

  it('serves readiness', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().database).toBe('connected');
    expect(res.json().redis).toBe('connected');
  });

  it('reports 503 when redis is unreachable', async () => {
    vi.mocked(redisConnection.ping).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('unavailable');
    expect(res.json().redis).toBe('unavailable');
    expect(res.json().database).toBe('connected');
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toHaveProperty('message');
  });

  it('applies security headers to every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('openapi / swagger', () => {
  it('rejects unauthenticated access to the docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(res.statusCode).toBe(401);
  });

  it('serves a valid OpenAPI spec derived from the registered routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/json', ...authed() });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('BotHive API');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(10);
    expect(Object.keys(spec.paths).some((p) => p.startsWith('/api/bots'))).toBe(true);
    expect(Object.keys(spec.paths).some((p) => p.startsWith('/api/auth'))).toBe(true);
  });

  it('serves the Swagger UI at /api/docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('swagger-ui');
  });

  it('exempts the docs routes from the strict CSP so the UI can render', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/json', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});

describe('auth', () => {
  it('requires auth on protected routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('registers the first user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'admin@bothive.test', password: 'password123', name: 'Admin' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.role).toBe('admin');
  });

  it('rejects further registrations when a user exists', async () => {
    seedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'second@bothive.test', password: 'password123' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('rejects weak passwords', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@bothive.test', password: 'short' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('exposes /me for the signed-in user', async () => {
    seedUser();
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${signToken('u1')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.email).toBe('admin@bothive.test');
  });

  it('rejects /me without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects tokens minted for a different audience/issuer', async () => {
    seedUser();
    const forged = app.jwt.sign(
      { id: 'u1', email: 'admin@bothive.test', role: 'admin' },
      { iss: 'other-service', aud: 'other-app' },
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('changes the password with the correct current password', async () => {
    seedUser();
    const auth = { authorization: `Bearer ${signToken('u1')}` };

    const wrong = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: auth,
      payload: { currentPassword: 'wrong-pass', newPassword: 'newpassword1' },
    });
    expect(wrong.statusCode).toBe(401);

    const good = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: auth,
      payload: { currentPassword: 'password123', newPassword: 'newpassword1' },
    });
    expect(good.statusCode).toBe(200);
  });

  it('logs in with correct and rejects wrong credentials', async () => {
    seedUser();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@bothive.test', password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);

    const good = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@bothive.test', password: 'password123' },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().data.token).toBeTruthy();
  });

  it('rate-limits repeated login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin@bothive.test', password: 'nope' },
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('bot', () => {
  it('never leaks account credentials in the list', async () => {
    seedAccount();
    seedBot('b1');

    const res = await app.inject({ method: 'GET', url: '/api/bots', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('super-secret-token-value');
    expect(res.body).not.toContain('client-secret');
    const account = res.json().data[0].account;
    expect(account).not.toHaveProperty('token');
    expect(account).not.toHaveProperty('clientId');
  });

  it('filters bots by platform', async () => {
    seedAccount();
    seedBot('b1', 'twitch');
    seedBot('b2', 'telegram');

    const res = await app.inject({
      method: 'GET',
      url: '/api/bots?platform=telegram',
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('b2');
  });

  it('rejects an invalid platform filter', async () => {
    seedAccount();
    seedBot('b1');

    const res = await app.inject({ method: 'GET', url: '/api/bots?platform=nope', ...authed() });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('filters bots by status', async () => {
    seedAccount();
    seedBot('b1', 'twitch', { status: 'running' });
    seedBot('b2', 'twitch', { status: 'stopped' });

    const res = await app.inject({ method: 'GET', url: '/api/bots?status=stopped', ...authed() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('b2');
  });

  it('searches bots by name substring (case-insensitive)', async () => {
    seedAccount();
    seedBot('b1');
    seedBot('b2');

    const res = await app.inject({ method: 'GET', url: '/api/bots?q=bot%20b2', ...authed() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('b2');
  });

  it('never leaks account credentials in a single bot', async () => {
    seedAccount();
    seedBot('b1');

    const res = await app.inject({ method: 'GET', url: '/api/bots/b1', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('super-secret-token-value');
  });

  it('creates a bot when the account platform matches', async () => {
    seedAccount();

    const okRes = await app.inject({
      method: 'POST',
      url: '/api/bots',
      ...authed(),
      payload: { name: 'New Bot', platform: 'twitch', accountId: 'a1' },
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().data.platform).toBe('twitch');

    const badRes = await app.inject({
      method: 'POST',
      url: '/api/bots',
      ...authed(),
      payload: { name: 'Bad', platform: 'telegram', accountId: 'a1' },
    });
    expect(badRes.statusCode).toBe(422);
  });

  it('creates a crypto bot with a dedicated EVM wallet and varied config', async () => {
    holder.db.seed('account', [
      {
        id: 'a1',
        name: 'Acc',
        platform: 'crypto',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bots',
      ...authed(),
      payload: { name: 'Crypto Bot', platform: 'crypto', accountId: 'a1' },
    });
    expect(res.statusCode).toBe(200);

    const crypto = res.json().data.config.crypto as Record<string, unknown>;
    const wallet = crypto.wallet as { address: string; privateKey: string };
    expect(wallet.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(wallet.privateKey).toMatch(/^enc:/);
    expect(Array.isArray(crypto.symbols)).toBe(true);
    expect((crypto.symbols as string[]).length).toBeGreaterThan(0);
    expect(crypto.tradeMode).toBe('dry');
    expect(JSON.stringify(res.json().data.config)).not.toContain('"privateKey":"0x');
  });

  it('keeps an explicit crypto config and only adds the wallet', async () => {
    holder.db.seed('account', [
      {
        id: 'a1',
        name: 'Acc',
        platform: 'crypto',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bots',
      ...authed(),
      payload: {
        name: 'C2',
        platform: 'crypto',
        accountId: 'a1',
        config: {
          crypto: { symbols: ['BTCUSDT'], source: 'coingecko', strategy: 'alert' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const crypto = res.json().data.config.crypto as Record<string, unknown>;
    expect(crypto.symbols).toEqual(['BTCUSDT']);
    expect(crypto.source).toBe('coingecko');
    expect((crypto.wallet as { address: string }).address).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('creates a batch of crypto bots each with its own EVM wallet', async () => {
    holder.db.seed('account', [
      {
        id: 'a1',
        name: 'Acc',
        platform: 'crypto',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const created: Array<{ config: { crypto: Record<string, unknown> } }> = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/bots',
        ...authed(),
        payload: { name: `Crypto ${i}`, platform: 'crypto', accountId: 'a1' },
      });
      expect(res.statusCode).toBe(200);
      created.push(res.json().data);
    }

    const wallets = created.map((b) => (b.config.crypto.wallet as { address: string }).address);
    expect(wallets).toHaveLength(5);
    expect(new Set(wallets).size).toBe(5);
    for (const address of wallets) expect(address).toMatch(/^0x[0-9a-f]{40}$/);
    for (const bot of created) {
      expect(bot.config.crypto.tradeMode).toBe('dry');
      const params = bot.config.crypto.strategyParams as Record<string, unknown>;
      expect(params.autoTrade).toBe(false);
    }
  });

  it('stores apiSecret and apiKeys encrypted and never leaks them', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      ...authed(),
      payload: {
        name: 'Binance',
        platform: 'crypto',
        credentials: {
          apiKey: 'plain-key-1',
          apiSecret: 'plain-secret-1',
          apiKeys: [
            { apiKey: 'plain-key-2', apiSecret: 'plain-secret-2' },
            { apiKey: 'plain-key-3', apiSecret: 'plain-secret-3' },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.credentials).toMatchObject({
      apiKey: true,
      apiSecret: true,
      apiKeys: true,
    });
    expect(res.body).not.toContain('plain-secret-1');
    expect(res.body).not.toContain('plain-secret-2');

    const accounts = await (
      holder.db.prisma.account as { findMany: () => Promise<Array<Record<string, unknown>>> }
    ).findMany();
    const stored = accounts[0];
    expect(stored.apiSecret).toMatch(/^enc:/);
    const pairs = stored.apiKeys as Array<{ apiKey: string; apiSecret: string }>;
    expect(pairs).toHaveLength(2);
    expect(pairs[0].apiKey).toMatch(/^enc:/);
    expect(pairs[0].apiSecret).toMatch(/^enc:/);

    // No account endpoint (list, single, delete) may ever return secret values
    // or their encrypted forms back to the client.
    const accountId = (res.json().data as { id: string }).id;
    for (const url of ['/api/accounts', `/api/accounts/${accountId}`]) {
      const list = await app.inject({ method: 'GET', url, ...authed() });
      expect(list.statusCode).toBe(200);
      expect(list.body).not.toContain('plain-secret-1');
      expect(list.body).not.toContain('plain-secret-2');
      expect(list.body).not.toContain('plain-key-2');
      expect(list.body).not.toContain('enc:');
    }

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/${accountId}`,
      ...authed(),
    });
    expect(del.statusCode).toBe(200);
    expect(del.body).not.toContain('plain-secret-1');
    expect(del.body).not.toContain('enc:');
  });

  it('clears credentials via PATCH with explicit nulls and an empty pool', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      ...authed(),
      payload: {
        name: 'ClearMe',
        platform: 'crypto',
        credentials: {
          apiKey: 'k1',
          apiSecret: 's1',
          apiKeys: [{ apiKey: 'k2', apiSecret: 's2' }],
        },
      },
    });
    expect(created.statusCode).toBe(200);
    const accountId = (created.json().data as { id: string }).id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${accountId}`,
      ...authed(),
      payload: { credentials: { apiKey: null, apiSecret: null, apiKeys: [] } },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.credentials).toEqual({});

    const accounts = await (
      holder.db.prisma.account as { findMany: () => Promise<Array<Record<string, unknown>>> }
    ).findMany();
    const stored = accounts.find((a) => a.id === accountId);
    expect(stored?.apiKey).toBeNull();
    expect(stored?.apiSecret).toBeNull();
    expect(stored?.apiKeys).toEqual([]);
  });

  it('preserves maxDailyOrderValueUsdt and allowedSymbols in bot configs', async () => {
    holder.db.seed('account', [
      {
        id: 'ca1',
        name: 'Binance',
        platform: 'crypto',
        apiKey: 'enc:k',
        apiSecret: 'enc:s',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bots',
      ...authed(),
      payload: {
        name: 'Whitelisted',
        platform: 'crypto',
        accountId: 'ca1',
        config: {
          crypto: {
            symbols: ['BTCUSDT'],
            maxDailyOrderValueUsdt: 250,
            allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.config.crypto).toMatchObject({
      maxDailyOrderValueUsdt: 250,
      allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
    });
  });

  it('queues crypto start with decrypted keys and rotation pairs', async () => {
    holder.db.seed('account', [
      {
        id: 'a1',
        name: 'Acc',
        platform: 'crypto',
        apiKey: 'binance-key-1',
        apiSecret: 'binance-secret-1',
        apiKeys: [{ apiKey: 'binance-key-2', apiSecret: 'binance-secret-2' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    holder.db.seed('bot', [
      {
        id: 'c1',
        name: 'Crypto',
        platform: 'crypto',
        accountId: 'a1',
        status: 'running',
        config: { crypto: { symbols: ['BTCUSDT'] } },
      },
    ]);

    const res = await app.inject({ method: 'POST', url: '/api/bots/c1/start', ...authed() });
    expect(res.statusCode).toBe(200);
    // Credentials never reach the queue: the worker resolves them from the DB.
    expect(enqueueConnect).toHaveBeenCalledWith('c1', 'crypto');
  });

  it('queues start without credentials', async () => {
    seedAccount();
    seedBot('b1');

    const res = await app.inject({ method: 'POST', url: '/api/bots/b1/start', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(enqueueConnect).toHaveBeenCalledWith('b1', 'twitch');
  });

  it('returns 404 for missing bots', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots/nope', ...authed() });
    expect(res.statusCode).toBe(404);
  });

  it('deletes a bot and enqueues disconnect', async () => {
    seedBot('b1');
    const res = await app.inject({ method: 'DELETE', url: '/api/bots/b1', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(deleteBotRuntimeState)).toHaveBeenCalledWith('b1');
  });

  it('deletes a bot even when the Redis cleanup fails', async () => {
    seedBot('b1');
    vi.mocked(deleteBotRuntimeState).mockRejectedValueOnce(new Error('redis down'));
    const res = await app.inject({ method: 'DELETE', url: '/api/bots/b1', ...authed() });
    expect(res.statusCode).toBe(200);
  });

  it('maps command errors to the right status code', async () => {
    seedBot('b1');
    dispatchSpy.mockResolvedValueOnce(err(AppError.validation({ name: 'taken' })));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/bots/b1',
      ...authed(),
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('queues a manual action for a bot', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/b1/action',
      ...authed(),
      payload: { type: 'sendMessage', payload: { chatId: 123, text: 'hello' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe('Action queued');
  });

  it('rejects manual actions without a type', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/b1/action',
      ...authed(),
      payload: { payload: {} },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects manual actions for missing bots', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/nope/action',
      ...authed(),
      payload: { type: 'sendMessage' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('bot memory', () => {
  it('lists memory entries for a bot', async () => {
    seedBot('b1');
    const entry = {
      key: 'visits',
      value: 42,
      ttl: 60,
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:01:00.000Z',
    };
    vi.mocked(getBotMemory).mockResolvedValueOnce([entry]);

    const res = await app.inject({ method: 'GET', url: '/api/bots/b1/memory', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([entry]);
  });

  it('clears all memory keys for a bot', async () => {
    seedBot('b1');
    vi.mocked(clearBotMemory).mockResolvedValueOnce(3);

    const res = await app.inject({ method: 'DELETE', url: '/api/bots/b1/memory', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ cleared: 3 });
  });

  it('deletes a single memory key', async () => {
    seedBot('b1');
    vi.mocked(deleteBotMemoryKey).mockResolvedValueOnce(true);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/bots/b1/memory/visits',
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ removed: true });
  });

  it('returns 404 for memory routes of missing bots', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots/nope/memory', ...authed() });
    expect(res.statusCode).toBe(404);
  });
});

describe('crypto state', () => {
  it('exposes the live ledger state for a crypto bot', async () => {
    seedBot('b1', 'crypto');
    const state = {
      tradeMode: 'live',
      positions: [{ symbol: 'BTCUSDT', quantity: 0.001, avgEntry: 60000 }],
      realizedPnl: 6,
      openOrders: [
        {
          clientOrderId: 'bh123',
          symbol: 'BTCUSDT',
          side: 'buy',
          type: 'limit',
          price: 59000,
          quantity: 0.001,
          placedAt: 1700000000000,
        },
      ],
      dailySpendUsdt: 59,
      updatedAt: '2026-08-19T00:00:00.000Z',
    };
    vi.mocked(getCryptoState).mockResolvedValueOnce(state);

    const res = await app.inject({
      method: 'GET',
      url: '/api/bots/b1/crypto/state',
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(state);
    expect(vi.mocked(getCryptoState)).toHaveBeenCalledWith('b1');
  });

  it('rejects the crypto state route for non-crypto bots', async () => {
    seedBot('b1', 'twitch');
    const res = await app.inject({
      method: 'GET',
      url: '/api/bots/b1/crypto/state',
      ...authed(),
    });
    expect(res.statusCode).toBe(422);
    expect(vi.mocked(getCryptoState)).not.toHaveBeenCalled();
  });

  it('returns 404 for the crypto state of missing bots', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/bots/nope/crypto/state',
      ...authed(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('scripts', () => {
  it('lists patterns with metadata and no generator', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scripts/patterns', ...authed() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.length).toBeGreaterThanOrEqual(7);
    expect(data.map((p: { id: string }) => p.id)).toEqual(
      expect.arrayContaining([
        'welcome',
        'auto-reply',
        'command',
        'counter',
        'moderation',
        'random-response',
        'donation-thanks',
        'link-guard',
        'heartbeat',
        'raid-host-thanks',
        'threshold-alert',
      ]),
    );
    for (const p of data) {
      expect(p).not.toHaveProperty('generate');
      expect(Array.isArray(p.params)).toBe(true);
    }
  });

  it('generates a script from a pattern', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/scripts/generate',
      ...authed(),
      payload: {
        botId: 'b1',
        name: 'Visitor counter',
        pattern: 'counter',
        params: { trigger: 'message', counterName: 'visits', reply: 'Visits: {counters.visits}' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.trigger).toBe('message');
    expect(body.config.actions[0].type).toBe('increment_counter');
    expect(notifyScriptsChanged).toHaveBeenCalled();
  });

  it('rejects generation with missing required params', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/scripts/generate',
      ...authed(),
      payload: { botId: 'b1', name: 'X', pattern: 'auto-reply', params: {} },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects unknown patterns', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/scripts/generate',
      ...authed(),
      payload: { botId: 'b1', name: 'X', pattern: 'nope', params: {} },
    });
    expect(res.statusCode).toBe(404);
  });

  it('supports manual script CRUD', async () => {
    seedBot('b1');
    const created = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: { botId: 'b1', name: 'Manual', trigger: 'message', config: { actions: [] } },
    });
    expect(created.statusCode).toBe(200);
    const scriptId = created.json().data.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/scripts/${scriptId}`,
      ...authed(),
      payload: { enabled: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.enabled).toBe(false);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/scripts/${scriptId}`,
      ...authed(),
    });
    expect(deleted.statusCode).toBe(200);
  });

  it('publishes a test trigger for a script', async () => {
    seedBot('b1');
    const created = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: { botId: 'b1', name: 'Testable', trigger: 'message', config: { actions: [] } },
    });
    const scriptId = created.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/scripts/${scriptId}/test`,
      ...authed(),
      payload: { sample: { text: 'hello' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(redisConnection.publish).toHaveBeenCalledWith(
      'bothive:script:trigger',
      JSON.stringify({ botId: 'b1', scriptId, sample: { text: 'hello' } }),
    );
  });

  it('rejects test trigger for a missing script', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/scripts/nope/test', ...authed() });
    expect(res.statusCode).toBe(404);
  });

  it('rejects invalid test sample payload', async () => {
    seedBot('b1');
    const created = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: { botId: 'b1', name: 'Testable', trigger: 'message', config: { actions: [] } },
    });
    const scriptId = created.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/scripts/${scriptId}/test`,
      ...authed(),
      payload: { sample: ['not', 'object'] },
    });
    expect(res.statusCode).toBe(422);
    expect(redisConnection.publish).not.toHaveBeenCalled();
  });

  it('clones a script as a disabled copy', async () => {
    seedBot('b1');
    const created = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: {
        botId: 'b1',
        name: 'Original',
        trigger: 'message',
        config: { actions: [{ type: 'reply', payload: { text: 'hi' } }] },
        enabled: true,
      },
    });
    const scriptId = created.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/scripts/${scriptId}/clone`,
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const clone = res.json().data;
    expect(clone.id).not.toBe(scriptId);
    expect(clone.name).toBe('Original (copy)');
    expect(clone.enabled).toBe(false);
    expect(clone.config).toEqual({ actions: [{ type: 'reply', payload: { text: 'hi' } }] });
    expect(notifyScriptsChanged).toHaveBeenCalled();
  });

  it('rejects cloning a missing script', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/scripts/nope/clone', ...authed() });
    expect(res.statusCode).toBe(404);
  });

  it('preserves cooldown, interval and maxExecutionMs on manual script creation', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: {
        botId: 'b1',
        name: 'Throttled',
        trigger: 'message',
        config: {
          actions: [{ type: 'reply', payload: { text: 'ok' } }],
          cooldown: 30,
          interval: 60,
          maxExecutionMs: 5000,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.config).toEqual({
      actions: [{ type: 'reply', payload: { text: 'ok' } }],
      cooldown: 30,
      interval: 60,
      maxExecutionMs: 5000,
    });
  });

  it('rejects out-of-range cooldown on manual script creation', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: {
        botId: 'b1',
        name: 'BadCooldown',
        trigger: 'message',
        config: { actions: [], cooldown: 99_000 },
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects script configs with catastrophic regex filters', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: {
        botId: 'b1',
        name: 'ReDoS',
        trigger: 'message',
        config: { filters: [{ type: 'regex', value: '^([a-z]+)+$' }], actions: [] },
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects script configs with sandbox-escaping custom code', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: {
        botId: 'b1',
        name: 'Esc',
        trigger: 'message',
        config: {
          actions: [
            {
              type: 'custom',
              payload: { code: 'this.constructor.constructor("return process")()' },
            },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects script config updates that fail safety checks', async () => {
    seedBot('b1');
    const created = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: { botId: 'b1', name: 'Safe', trigger: 'message', config: { actions: [] } },
    });
    const scriptId = created.json().data.id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/scripts/${scriptId}`,
      ...authed(),
      payload: { config: { actions: [{ type: 'delay', payload: { ms: 999_999_999 } }] } },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('bulk', () => {
  it('rejects invalid bulk actions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bulk/bots',
      ...authed(),
      payload: { ids: ['b1'], action: 'explode' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('runs a bulk restart', async () => {
    seedAccount();
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/bulk/bots',
      ...authed(),
      payload: { ids: ['b1', 'missing'], action: 'restart' },
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().data;
    expect(results[0].status).toBe('queued');
    expect(results[1]).toEqual({ id: 'missing', status: 'error', error: 'not found' });
  });

  it('bulk starts crypto bots with decrypted keys and rotation pools', async () => {
    holder.db.seed('account', [
      {
        id: 'a1',
        name: 'Binance',
        platform: 'crypto',
        apiKey: 'key-1',
        apiSecret: 'secret-1',
        apiKeys: [{ apiKey: 'key-2', apiSecret: 'secret-2' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    holder.db.seed('bot', [
      {
        id: 'c1',
        name: 'C1',
        platform: 'crypto',
        accountId: 'a1',
        status: 'idle',
        config: {
          crypto: {
            symbols: ['BTCUSDT'],
            wallet: { address: `0x${'a'.repeat(40)}`, privateKey: 'enc:pk' },
          },
        },
      },
      {
        id: 'c2',
        name: 'C2',
        platform: 'crypto',
        accountId: 'a1',
        status: 'idle',
        config: {
          crypto: {
            symbols: ['ETHUSDT'],
            wallet: { address: `0x${'b'.repeat(40)}`, privateKey: 'enc:pk' },
          },
        },
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/bulk/bots',
      ...authed(),
      payload: { ids: ['c1', 'c2', 'missing'], action: 'start' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      { id: 'c1', status: 'queued' },
      { id: 'c2', status: 'queued' },
      { id: 'missing', status: 'error', error: 'not found' },
    ]);

    // Credentials never reach the queue; the worker resolves them from the DB.
    expect(enqueueConnect).toHaveBeenCalledWith('c1', 'crypto');
    expect(enqueueConnect).toHaveBeenCalledWith('c2', 'crypto');

    const rows = await (
      holder.db.prisma.bot as { findMany: () => Promise<Array<Record<string, unknown>>> }
    ).findMany();
    expect(rows.map((r) => r.status)).toEqual(['connecting', 'connecting']);
  });

  it('bulk restarts and stops crypto bots through the crypto queue', async () => {
    holder.db.seed('account', [
      {
        id: 'a1',
        name: 'Binance',
        platform: 'crypto',
        apiKey: 'key-1',
        apiSecret: 'secret-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    holder.db.seed('bot', [
      {
        id: 'c1',
        name: 'C1',
        platform: 'crypto',
        accountId: 'a1',
        status: 'running',
        config: {
          crypto: {
            symbols: ['BTCUSDT'],
            wallet: { address: `0x${'a'.repeat(40)}`, privateKey: 'enc:pk' },
          },
        },
      },
      {
        id: 'c2',
        name: 'C2',
        platform: 'crypto',
        accountId: 'a1',
        status: 'running',
        config: {
          crypto: {
            symbols: ['ETHUSDT'],
            wallet: { address: `0x${'b'.repeat(40)}`, privateKey: 'enc:pk' },
          },
        },
      },
    ]);

    const restart = await app.inject({
      method: 'POST',
      url: '/api/bulk/bots',
      ...authed(),
      payload: { ids: ['c1'], action: 'restart' },
    });
    expect(restart.statusCode).toBe(200);
    // Restart no longer enqueues a disconnect: the delayed connect replaces
    // the live connection itself (the worker's connect guard lets a
    // 'reconnecting' status override a live connection).
    expect(enqueueDisconnect).not.toHaveBeenCalled();
    const cryptoQueue = vi.mocked(getQueue).mock.results.at(-1)!.value as {
      add: ReturnType<typeof vi.fn>;
    };
    expect(cryptoQueue.add).toHaveBeenCalledWith(
      'connect',
      expect.objectContaining({
        botId: 'c1',
        type: 'connect',
        data: {},
      }),
      expect.objectContaining({ jobId: 'connect-c1', delay: 1000 }),
    );
    const restarted = await (
      holder.db.prisma.bot as { findMany: () => Promise<Array<Record<string, unknown>>> }
    ).findMany();
    expect(restarted.map((r) => r.status)).toEqual(['reconnecting', 'running']);

    const stop = await app.inject({
      method: 'POST',
      url: '/api/bulk/bots',
      ...authed(),
      payload: { ids: ['c1', 'c2'], action: 'stop' },
    });
    expect(stop.statusCode).toBe(200);
    expect(enqueueDisconnect).toHaveBeenCalledWith('c1', 'crypto');
    expect(enqueueDisconnect).toHaveBeenCalledWith('c2', 'crypto');

    const rows = await (
      holder.db.prisma.bot as { findMany: () => Promise<Array<Record<string, unknown>>> }
    ).findMany();
    expect(rows.map((r) => r.status)).toEqual(['idle', 'idle']);
  });

  it('bulk enables, disables and deletes scripts', async () => {
    seedBot('b1');
    const created = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: {
        botId: 'b1',
        name: 'A',
        trigger: 'message',
        config: { actions: [] },
        enabled: false,
      },
    });
    const scriptId = created.json().data.id;

    const enabled = await app.inject({
      method: 'POST',
      url: '/api/bulk/scripts',
      ...authed(),
      payload: { ids: [scriptId], action: 'enable' },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().data[0].status).toBe('updated');
    expect(notifyScriptsChanged).toHaveBeenCalled();

    const deleted = await app.inject({
      method: 'POST',
      url: '/api/bulk/scripts',
      ...authed(),
      payload: { ids: [scriptId], action: 'delete' },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data[0].status).toBe('deleted');

    const gone = await app.inject({ method: 'GET', url: `/api/scripts/${scriptId}`, ...authed() });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects invalid bulk script actions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bulk/scripts',
      ...authed(),
      payload: { ids: ['x'], action: 'explode' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects empty bulk script ids', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bulk/scripts',
      ...authed(),
      payload: { ids: [], action: 'enable' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('queues', () => {
  it('returns queue metrics for authenticated users', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/queues', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it('requires auth for queue metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/queues' });
    expect(res.statusCode).toBe(401);
  });
});

describe('metrics endpoint', () => {
  beforeEach(() => {
    delete process.env.METRICS_TOKEN;
    delete process.env.METRICS_OPEN;
  });

  it('requires authentication when no token is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(401);
  });

  it('serves metrics to authenticated users', async () => {
    holder.db.seed('bot', [
      { id: 'm1', name: 'M', platform: 'twitch', accountId: 'a1', status: 'running', config: {} },
    ]);
    const res = await app.inject({ method: 'GET', url: '/metrics', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('bothive_bots_total');
  });

  it('gzip-compresses metrics when the client advertises gzip', async () => {
    const plain = await app.inject({ method: 'GET', url: '/metrics', ...authed() });
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['content-encoding']).toBeUndefined();

    const gz = await app.inject({
      method: 'GET',
      url: '/metrics',
      ...authed({ 'accept-encoding': 'gzip' }),
    });
    expect(gz.statusCode).toBe(200);
    expect(gz.headers['content-encoding']).toBe('gzip');
  });

  it('accepts a configured bearer token', async () => {
    process.env.METRICS_TOKEN = 'metrics-bearer-token';
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer metrics-bearer-token' },
      });
      expect(res.statusCode).toBe(200);
      const bad = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer wrong' },
      });
      expect(bad.statusCode).toBe(401);
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });

  it('opens /metrics without auth when METRICS_OPEN is set', async () => {
    process.env.METRICS_OPEN = 'true';
    try {
      const res = await app.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('bothive_bots_total');
    } finally {
      delete process.env.METRICS_OPEN;
    }
  });

  it('exposes gauges that reflect the database state', async () => {
    process.env.METRICS_TOKEN = 'metrics-bearer-token';
    try {
      holder.db.seed('account', [
        {
          id: 'a1',
          name: 'A',
          platform: 'twitch',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      holder.db.seed('bot', [
        {
          id: 'b1',
          name: 'B1',
          platform: 'twitch',
          accountId: 'a1',
          status: 'running',
          config: {},
        },
        {
          id: 'b2',
          name: 'B2',
          platform: 'telegram',
          accountId: 'a1',
          status: 'running',
          config: {},
        },
        { id: 'b3', name: 'B3', platform: 'twitch', accountId: 'a1', status: 'error', config: {} },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer metrics-bearer-token' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('bothive_bots_total 3');
      expect(res.body).toContain('bothive_bots_active 2');
      expect(res.body).toContain('bothive_bots_error 1');
      expect(res.body).toContain('bothive_accounts_total 1');
      expect(res.body).toContain('nodejs_uptime_seconds');
      expect(res.body).toContain('nodejs_heap_size_bytes');
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });

  it('exposes per-bot health scores published by workers', async () => {
    process.env.METRICS_TOKEN = 'metrics-bearer-token';
    const scan = vi.mocked(redisConnection.scan);
    const mget = vi.mocked(redisConnection.mget);
    scan.mockResolvedValue(['0', ['bothive:health:b1']]);
    mget.mockResolvedValue([
      '{"score":42,"status":"running","uptimeSeconds":120,"actionsSuccess":10,"actionsFailed":2,"reconnectAttempts":3,"scriptExecutions":7,"scriptErrors":1}',
    ]);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer metrics-bearer-token' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('bothive_bot_script_errors_total{bot_id="b1"} 1');
      expect(res.body).toContain('bothive_bot_health_score{bot_id="b1",status="running"} 42');
      expect(res.body).toContain('bothive_bot_uptime_seconds{bot_id="b1",status="running"} 120');
      expect(res.body).toContain('bothive_bot_actions_total{bot_id="b1",result="success"} 10');
      expect(res.body).toContain('bothive_bot_actions_total{bot_id="b1",result="failure"} 2');
      expect(res.body).toContain('bothive_bot_reconnect_attempts_total{bot_id="b1"} 3');
      expect(res.body).toContain('bothive_bot_script_executions_total{bot_id="b1"} 7');
    } finally {
      scan.mockResolvedValue(['0', []]);
      mget.mockResolvedValue([]);
      delete process.env.METRICS_TOKEN;
    }
  });

  it('exposes BullMQ queue depths as gauges', async () => {
    process.env.METRICS_TOKEN = 'metrics-bearer-token';
    const getAll = vi.mocked(getAllQueueMetrics);
    getAll.mockResolvedValue([
      { platform: 'telegram', waiting: 3, active: 1, completed: 10, failed: 2, delayed: 0 },
    ]);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer metrics-bearer-token' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('bothive_queue_jobs{queue="telegram",state="waiting"} 3');
      expect(res.body).toContain('bothive_queue_jobs{queue="telegram",state="failed"} 2');
      expect(res.body).toContain('bothive_worker_queue_depth{platform="telegram"} 4');
    } finally {
      getAll.mockResolvedValue([]);
      delete process.env.METRICS_TOKEN;
    }
  });

  it('exposes worker liveness and concurrency from JSON heartbeats', async () => {
    process.env.METRICS_TOKEN = 'metrics-bearer-token';
    const scan = vi.mocked(redisConnection.scan);
    const get = vi.mocked(redisConnection.get);
    scan.mockResolvedValue([
      '0',
      ['worker:heartbeat:telegram:inst-1', 'worker:heartbeat:twitch:inst-2'],
    ]);
    get.mockImplementation(async (key) =>
      key === 'worker:heartbeat:telegram:inst-1'
        ? JSON.stringify({
            ts: Date.now(),
            concurrency: 20,
            version: '1.0.0',
            rss: 104857600,
            heapUsed: 52428800,
            heapTotal: 78643200,
            waitP50: 1.234,
            waitP95: 8.5,
            waitP99: 15.25,
            sandboxWorkers: 2,
          })
        : null,
    );
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer metrics-bearer-token' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('bothive_worker_up{platform="telegram"} 1');
      expect(res.body).toContain('bothive_worker_up{platform="twitch"} 0');
      expect(res.body).toContain('bothive_worker_concurrency_current{platform="telegram"} 20');
      expect(res.body).toContain(
        'bothive_worker_memory_bytes{platform="telegram",instance="inst-1",type="rss"} 104857600',
      );
      expect(res.body).toContain(
        'bothive_worker_memory_bytes{platform="telegram",instance="inst-1",type="heapUsed"} 52428800',
      );
      expect(res.body).toContain(
        'bothive_worker_memory_bytes{platform="telegram",instance="inst-1",type="heapTotal"} 78643200',
      );
      expect(res.body).toContain(
        'bothive_worker_sandbox_workers{platform="telegram",instance="inst-1"} 2',
      );
      expect(res.body).toContain(
        'bothive_queue_wait_seconds{platform="telegram",instance="inst-1",quantile="p95"} 8.5',
      );
      expect(res.body).toContain(
        'bothive_queue_wait_seconds{platform="telegram",instance="inst-1",quantile="p99"} 15.25',
      );
    } finally {
      scan.mockResolvedValue(['0', []]);
      get.mockResolvedValue(null);
      delete process.env.METRICS_TOKEN;
    }
  });

  it('buckets unmatched routes under a single bounded label', async () => {
    process.env.METRICS_TOKEN = 'metrics-bearer-token';
    try {
      await app.inject({ method: 'GET', url: '/totally/unknown/path/xyz' });
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer metrics-bearer-token' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('route="unmatched"');
      expect(res.body).not.toContain('/totally/unknown/path/xyz');
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });

  it('records request histograms for real routes', async () => {
    process.env.METRICS_TOKEN = 'metrics-bearer-token';
    try {
      await app.inject({ method: 'GET', url: '/health' });
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer metrics-bearer-token' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('# TYPE http_request_duration_seconds histogram');
      expect(res.body).toContain('# TYPE http_response_size_bytes histogram');
      expect(res.body).toContain('route="/health"');
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });
});

describe('logs and stats', () => {
  it('exports logs as CSV', async () => {
    holder.db.seed('log', [
      {
        id: 'l1',
        botId: 'b1',
        level: 'info',
        message: 'Hello, "world"',
        meta: { a: 1 },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/logs/export', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('"id","botId","level","message","meta","createdAt"');
    expect(res.body).toContain('Hello, ""world""');
  });

  it('filters log export by bot and level', async () => {
    holder.db.seed('log', [
      {
        id: 'l1',
        botId: 'b1',
        level: 'info',
        message: 'keep',
        meta: {},
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'l2',
        botId: 'b2',
        level: 'error',
        message: 'drop',
        meta: {},
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs/export?botId=b1&level=info',
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('keep');
    expect(res.body).not.toContain('drop');
  });

  it('lists logs filtered by bot', async () => {
    holder.db.seed('log', [
      {
        id: 'l1',
        botId: 'b1',
        level: 'info',
        message: 'hello',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'l2',
        botId: 'b2',
        level: 'error',
        message: 'boom',
        createdAt: new Date().toISOString(),
      },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/logs?botId=b1', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.total).toBe(1);
    expect(res.json().data.logs[0].message).toBe('hello');
  });

  it('returns aggregated stats', async () => {
    holder.db.seed('account', [
      {
        id: 'a1',
        name: 'A',
        platform: 'twitch',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    holder.db.seed('bot', [
      { id: 'b1', name: 'B1', platform: 'twitch', accountId: 'a1', status: 'running', config: {} },
      { id: 'b2', name: 'B2', platform: 'telegram', accountId: 'a1', status: 'idle', config: {} },
    ]);
    holder.db.seed('script', [
      {
        id: 's1',
        botId: 'b1',
        name: 'S1',
        trigger: 'message',
        config: {},
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 's2',
        botId: 'b2',
        name: 'S2',
        trigger: 'follow',
        config: {},
        enabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    holder.db.seed('webhook', [
      {
        id: 'w1',
        name: 'W1',
        url: 'https://x',
        events: ['message'],
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    holder.db.seed('log', [
      {
        id: 'l1',
        botId: 'b1',
        level: 'error',
        message: 'boom',
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/stats', ...authed() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.totalBots).toBe(2);
    expect(data.activeBots).toBe(1);
    expect(data.totalAccounts).toBe(1);
    expect(data.totalScripts).toBe(2);
    expect(data.enabledScripts).toBe(1);
    expect(data.totalWebhooks).toBe(1);
    expect(data.enabledWebhooks).toBe(1);
    expect(data.errors24h).toBe(1);
  });
});

describe('webhooks', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/webhooks' });
    expect(res.statusCode).toBe(401);
  });

  it('stores webhook secrets encrypted at rest', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: {
        name: 'Secret',
        url: 'https://example.com/hook',
        events: ['message'],
        secret: 'hmac-secret',
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.hasSecret).toBe(true);
    expect(created.json().data).not.toHaveProperty('secret');

    const id = created.json().data.id as string;
    const stored = (await app.prisma.webhook.findUnique({ where: { id } })) as {
      secret: string | null;
    };
    expect(stored.secret).toMatch(/^enc:/);
    expect(stored.secret).not.toBe('hmac-secret');
  });

  it('creates, lists, updates and deletes a webhook', async () => {
    seedBot('b1');
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: {
        name: 'Alerts',
        url: 'https://example.com/hook',
        events: ['follow', 'donation'],
        botId: 'b1',
        secret: 'hmac-secret',
      },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().data.id;
    expect(created.json().data.enabled).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/api/webhooks', ...authed() });
    expect(list.json().data.length).toBe(1);
    expect(list.json().data[0].name).toBe('Alerts');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/webhooks/${id}`,
      ...authed(),
      payload: { enabled: false, events: ['message'] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.enabled).toBe(false);
    expect(patched.json().data.events).toEqual(['message']);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/webhooks/${id}`, ...authed() });
    expect(deleted.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/webhooks', ...authed() });
    expect(after.json().data.length).toBe(0);
  });

  it('rejects invalid urls and events', async () => {
    const badUrl = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: { name: 'X', url: 'not-a-url', events: ['message'] },
    });
    expect(badUrl.statusCode).toBe(422);

    const badEvents = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: { name: 'X', url: 'https://example.com', events: ['mystery'] },
    });
    expect(badEvents.statusCode).toBe(422);

    const emptyEvents = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: { name: 'X', url: 'https://example.com', events: [] },
    });
    expect(emptyEvents.statusCode).toBe(422);
  });

  it('rejects webhooks pointing at missing bots', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: { name: 'X', url: 'https://example.com', events: ['message'], botId: 'ghost' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects webhooks targeting private or loopback addresses', async () => {
    for (const url of [
      'http://127.0.0.1:3000/x',
      'http://10.0.0.5/x',
      'http://192.168.1.10/x',
      'http://169.254.169.254/latest/meta-data',
      'http://localhost:8080/x',
      'http://foo.local/x',
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        ...authed(),
        payload: { name: 'X', url, events: ['message'] },
      });
      expect(res.statusCode).toBe(422);
    }
  });

  it('reports a failed test delivery', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: { name: 'X', url: 'https://example.com/nope', events: ['message'] },
    });
    const id = created.json().data.id;
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.inject({ method: 'POST', url: `/api/webhooks/${id}/test`, ...authed() });
    vi.unstubAllGlobals();
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('WEBHOOK_DELIVERY_FAILED');
  });

  it('delivers a test with a custom sample and event type, recording the delivery', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: { name: 'X', url: 'https://example.com/hook', events: ['message'] },
    });
    const id = created.json().data.id;

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/${id}/test`,
      ...authed(),
      payload: { eventType: 'follow', sample: { username: 'alice' } },
    });
    vi.unstubAllGlobals();

    expect(res.statusCode).toBe(200);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.type).toBe('follow');
    expect(sentBody.payload.username).toBe('alice');

    const list = await app.inject({ method: 'GET', url: '/api/webhooks', ...authed() });
    const wh = list.json().data.find((w: { id: string }) => w.id === id);
    expect(wh.lastStatus).toBe('ok');
    expect(wh.lastDeliveredAt).toBeTruthy();

    const history = await app.inject({
      method: 'GET',
      url: `/api/webhooks/${id}/deliveries`,
      ...authed(),
    });
    expect(history.json().data).toHaveLength(1);
    expect(history.json().data[0]).toMatchObject({
      status: 'ok',
      statusCode: 200,
      eventType: 'follow',
    });
  });

  it('lists the delivery history for a webhook', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: { name: 'X', url: 'https://example.com/hook', events: ['message'] },
    });
    const id = created.json().data.id;
    await app.prisma.webhookDelivery.create({
      data: {
        webhookId: id,
        eventType: 'message',
        botId: 'b1',
        status: 'ok',
        statusCode: 200,
        attempt: 1,
        latencyMs: 42,
        createdAt: new Date('2026-08-19T00:00:00.000Z'),
      },
    });
    await app.prisma.webhookDelivery.create({
      data: {
        webhookId: id,
        eventType: 'follow',
        botId: null,
        status: 'failed',
        statusCode: 500,
        attempt: 2,
        error: 'webhook responded with status 500',
        latencyMs: 120,
        createdAt: new Date('2026-08-19T00:01:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/webhooks/${id}/deliveries`,
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data;
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('failed'); // newest first
    expect(rows[0].error).toContain('500');
    expect(rows[1].status).toBe('ok');
  });

  it('returns 404 for the delivery history of missing webhooks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/webhooks/nope/deliveries',
      ...authed(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a test payload that is not an object', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: { name: 'X', url: 'https://example.com/hook', events: ['message'] },
    });
    const id = created.json().data.id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/${id}/test`,
      ...authed(),
      payload: { sample: 'nope' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('never exposes the HMAC secret to clients', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: {
        name: 'Alerts',
        url: 'https://example.com/hook',
        events: ['message'],
        secret: 'top-secret-hmac',
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.hasSecret).toBe(true);
    expect(created.json().data.secret).toBeUndefined();
    expect(created.body).not.toContain('top-secret-hmac');

    const list = await app.inject({ method: 'GET', url: '/api/webhooks', ...authed() });
    expect(list.json().data[0].hasSecret).toBe(true);
    expect(list.json().data[0].secret).toBeUndefined();
    expect(list.body).not.toContain('top-secret-hmac');
  });

  it('PATCH without a secret preserves the existing secret', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: {
        name: 'X',
        url: 'https://example.com/hook',
        events: ['message'],
        secret: 'keep-me',
      },
    });
    const id = created.json().data.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/webhooks/${id}`,
      ...authed(),
      payload: { enabled: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.hasSecret).toBe(true);
    expect(patched.json().data.secret).toBeUndefined();

    const webhookModel = (
      holder.db as unknown as {
        prisma: { webhook: { findMany: (a?: unknown) => Promise<Array<Record<string, unknown>>> } };
      }
    ).prisma.webhook;
    const stored = (await webhookModel.findMany()).find((w) => w.id === id);
    expect(stored?.secret).toMatch(/^enc:/);
  });
});

describe('backup', () => {
  const ts = new Date().toISOString();

  it('exports accounts, bots and scripts with consistent refs', async () => {
    holder.db.seed('account', [
      {
        id: 'a1',
        name: 'Main',
        platform: 'twitch',
        token: 'super-secret-token-value',
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: 'a2',
        name: 'Tg',
        platform: 'telegram',
        token: 'tg-token',
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: 'a3',
        name: 'Binance',
        platform: 'crypto',
        apiSecret: 'enc:exported-secret',
        apiKeys: [{ apiKey: 'enc:exported-key', apiSecret: 'enc:exported-pool-secret' }],
        createdAt: ts,
        updatedAt: ts,
      },
    ]);
    holder.db.seed('bot', [
      {
        id: 'b1',
        name: 'B1',
        platform: 'twitch',
        accountId: 'a1',
        status: 'running',
        config: { channel: '#x' },
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: 'b2',
        name: 'B2',
        platform: 'telegram',
        accountId: 'a2',
        status: 'idle',
        config: {},
        createdAt: ts,
        updatedAt: ts,
      },
    ]);
    holder.db.seed('script', [
      {
        id: 's1',
        botId: 'b1',
        name: 'Greeter',
        trigger: 'follow',
        config: {},
        enabled: true,
        createdAt: ts,
        updatedAt: ts,
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/backup/export', ...authed() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.app).toBe('bothive');
    expect(data.accounts.length).toBe(3);
    expect(data.accounts[0].token).toBe('super-secret-token-value');
    expect(data.accounts[2]).toEqual(
      expect.objectContaining({
        name: 'Binance',
        apiSecret: 'enc:exported-secret',
        apiKeys: [{ apiKey: 'enc:exported-key', apiSecret: 'enc:exported-pool-secret' }],
      }),
    );
    expect(data.bots[0]).toEqual(
      expect.objectContaining({ name: 'B1', accountRef: 0, config: { channel: '#x' } }),
    );
    expect(data.scripts[0]).toEqual(
      expect.objectContaining({ botRef: 0, name: 'Greeter', trigger: 'follow' }),
    );
  });

  it('imports a full backup', async () => {
    const payload = {
      accounts: [
        { name: 'Main', platform: 'twitch', token: 'new-token' },
        { name: 'Tg', platform: 'telegram', token: 'tg-token' },
      ],
      bots: [{ name: 'B1', platform: 'twitch', accountRef: 0, config: { channel: '#x' } }],
      scripts: [
        { botRef: 0, name: 'Greeter', trigger: 'follow', config: { actions: [] }, enabled: true },
      ],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload,
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.accounts.created).toBe(2);
    expect(data.bots.created).toBe(1);
    expect(data.scripts.created).toBe(1);

    const bots = await app.inject({ method: 'GET', url: '/api/bots', ...authed() });
    expect(bots.json().data.length).toBe(1);
    expect(bots.json().data[0].config.channel).toBe('#x');
  });

  it('imports Binance apiSecret and apiKeys pools encrypted', async () => {
    const payload = {
      accounts: [
        {
          name: 'Binance',
          platform: 'crypto',
          apiSecret: 'plain-imported-secret',
          apiKeys: [{ apiKey: 'plain-imported-key', apiSecret: 'plain-imported-pool-secret' }],
        },
      ],
      bots: [],
      scripts: [],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload,
    });
    expect(res.statusCode).toBe(200);

    const accounts = await (
      holder.db.prisma.account as { findMany: () => Promise<Array<Record<string, unknown>>> }
    ).findMany();
    const stored = accounts.find((a) => a.name === 'Binance');
    expect(stored?.apiSecret).toMatch(/^enc:/);
    const pairs = stored?.apiKeys as Array<{ apiKey: string; apiSecret: string }>;
    expect(pairs).toHaveLength(1);
    expect(pairs[0].apiKey).toMatch(/^enc:/);
    expect(pairs[0].apiSecret).toMatch(/^enc:/);
  });

  it('rejects backups with a malformed apiKeys pool', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload: {
        accounts: [{ name: 'Binance', platform: 'crypto', apiKeys: 'not-an-array' }],
        bots: [],
        scripts: [],
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('updates existing accounts, bots and scripts on re-import', async () => {
    holder.db.seed('account', [
      { id: 'a1', name: 'Main', platform: 'twitch', token: 'old', createdAt: ts, updatedAt: ts },
    ]);
    holder.db.seed('bot', [
      {
        id: 'b1',
        name: 'B1',
        platform: 'twitch',
        accountId: 'a1',
        status: 'idle',
        config: {},
        createdAt: ts,
        updatedAt: ts,
      },
    ]);
    holder.db.seed('script', [
      {
        id: 's1',
        botId: 'b1',
        name: 'Greeter',
        trigger: 'follow',
        config: {},
        enabled: true,
        createdAt: ts,
        updatedAt: ts,
      },
    ]);

    const payload = {
      accounts: [{ name: 'Main', platform: 'twitch', token: 'rotated' }],
      bots: [{ name: 'B1', platform: 'twitch', accountRef: 0, config: { channel: '#y' } }],
      scripts: [{ botRef: 0, name: 'Greeter', trigger: 'message', config: {}, enabled: false }],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      accounts: { created: 0, updated: 1 },
      bots: { created: 0, updated: 1 },
      scripts: { created: 0, updated: 1 },
    });
  });

  it('rejects malformed backups', async () => {
    const noArrays = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload: { accounts: [], bots: [] },
    });
    expect(noArrays.statusCode).toBe(422);

    const badRef = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload: {
        accounts: [{ name: 'A', platform: 'twitch' }],
        bots: [{ name: 'B', platform: 'twitch', accountRef: 5 }],
        scripts: [],
      },
    });
    expect(badRef.statusCode).toBe(422);
  });

  it('rejects backups from a newer format version', async () => {
    const newer = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload: { version: 2, accounts: [], bots: [], scripts: [] },
    });
    expect(newer.statusCode).toBe(422);

    const legacy = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload: { accounts: [], bots: [], scripts: [] },
    });
    expect(legacy.statusCode).toBe(200);
  });

  it('rejects oversized backups', async () => {
    const payload = {
      accounts: Array.from({ length: 1001 }, (_, i) => ({ name: `A${i}`, platform: 'twitch' })),
      bots: [],
      scripts: [],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload,
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects scripts with unsafe custom code on import', async () => {
    const payload = {
      accounts: [{ name: 'A', platform: 'twitch' }],
      bots: [{ name: 'B', platform: 'twitch', accountRef: 0, config: {} }],
      scripts: [
        {
          botRef: 0,
          name: 'Bad',
          trigger: 'message',
          config: {
            actions: [
              {
                type: 'custom',
                payload: { code: 'ctx.constructor.constructor("return process")()' },
              },
            ],
          },
          enabled: true,
        },
      ],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload,
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects scripts with disallowed webhook URLs on import', async () => {
    const payload = {
      accounts: [{ name: 'A', platform: 'twitch' }],
      bots: [{ name: 'B', platform: 'twitch', accountRef: 0, config: {} }],
      scripts: [
        {
          botRef: 0,
          name: 'Bad',
          trigger: 'message',
          config: { actions: [{ type: 'webhook', payload: { url: 'http://127.0.0.1:9999/x' } }] },
          enabled: true,
        },
      ],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload,
    });
    expect(res.statusCode).toBe(422);
  });

  it('encrypts plaintext credentials on import and keeps round-trips encrypted', async () => {
    const plaintext = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload: {
        accounts: [{ name: 'Plain', platform: 'twitch', token: 'plain-token-value' }],
        bots: [],
        scripts: [],
      },
    });
    expect(plaintext.statusCode).toBe(200);

    const accounts = await app.inject({ method: 'GET', url: '/api/accounts', ...authed() });
    expect(accounts.json().data[0].credentials.token).toBe(true);
    expect(accounts.body).not.toContain('plain-token-value');

    const reExport = await app.inject({ method: 'GET', url: '/api/backup/export', ...authed() });
    const exportedToken = reExport.json().data.accounts[0].token;
    expect(exportedToken).toMatch(/^enc:/);
  });
});

describe('queue failed jobs', () => {
  it('lists failed jobs for admins and hides them from viewers', async () => {
    const { getFailedJobs } = await import('../services/queue.js');
    vi.mocked(getFailedJobs).mockResolvedValue([
      {
        id: 'j1',
        platform: 'twitch',
        name: 'connect',
        type: 'connect',
        botId: 'b1',
        attemptsMade: 1,
        failedReason: 'rate limited',
        timestamp: Date.now(),
      },
    ]);

    const admin = await app.inject({ method: 'GET', url: '/api/queues/failed', ...authed() });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().data).toHaveLength(1);
    expect(admin.json().data[0].failedReason).toBe('rate limited');

    seedUser();
    holder.db.seed('user', [
      {
        id: 'v1',
        email: 'viewer@bothive.test',
        name: 'Viewer',
        role: 'viewer',
        passwordHash: seededHash,
      },
    ]);
    const viewer = await app.inject({
      method: 'GET',
      url: '/api/queues/failed',
      headers: { authorization: `Bearer ${signToken('v1', 'viewer@bothive.test')}` },
    });
    expect(viewer.statusCode).toBe(403);
  });

  it('requires auth on failed jobs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/queues/failed' });
    expect(res.statusCode).toBe(401);
  });
});

describe('worker health', () => {
  it('reports per-platform liveness from heartbeat keys', async () => {
    vi.mocked(redisConnection.scan).mockResolvedValue([
      '0',
      ['worker:heartbeat:telegram:inst-1', 'worker:heartbeat:youtube:inst-2'],
    ]);
    vi.mocked(redisConnection.get).mockImplementation(async (key) =>
      String(key).includes('telegram:')
        ? JSON.stringify({ ts: Date.now(), concurrency: 20, version: '2.1.0' })
        : String(key).includes('youtube:')
          ? String(Date.now() - 120_000)
          : null,
    );

    const res = await app.inject({ method: 'GET', url: '/api/health/workers', ...authed() });
    expect(res.statusCode).toBe(200);
    const byPlatform = Object.fromEntries(
      res.json().data.map((w: { platform: string; alive: boolean }) => [w.platform, w.alive]),
    );
    expect(byPlatform).toEqual({
      telegram: true,
      twitch: false,
      youtube: false,
      twitter: false,
      crypto: false,
    });
    const telegram = res.json().data.find((w: { platform: string }) => w.platform === 'telegram');
    expect(telegram.concurrency).toBe(20);
    expect(telegram.version).toBe('2.1.0');
  });

  it('requires auth on worker health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/workers' });
    expect(res.statusCode).toBe(401);
  });
});

describe('proxies', () => {
  const ts = new Date().toISOString();
  const plain = 'http://user:pass@proxy.example.com:3128';

  const seedProxy = (extra: Record<string, unknown> = {}) =>
    holder.db.seed('proxy', [
      {
        id: 'p1',
        url: encryptCredential(plain),
        type: 'http',
        priority: 0,
        enabled: true,
        healthScore: 100,
        lastFailedAt: null,
        requestsCount: 0,
        failureCount: 0,
        createdAt: ts,
        updatedAt: ts,
        ...extra,
      },
    ]);

  it('requires admin role', async () => {
    const noAuth = await app.inject({ method: 'GET', url: '/api/proxies' });
    expect(noAuth.statusCode).toBe(401);

    holder.db.seed('user', [
      {
        id: 'v1',
        email: 'viewer@bothive.test',
        name: 'Viewer',
        role: 'viewer',
        passwordHash: seededHash,
      },
    ]);
    const viewer = await app.inject({
      method: 'GET',
      url: '/api/proxies',
      headers: { authorization: `Bearer ${signToken('v1', 'viewer@bothive.test')}` },
    });
    expect(viewer.statusCode).toBe(403);
  });

  it('creates a proxy and stores the url encrypted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxies',
      ...authed(),
      payload: { url: plain, type: 'http', priority: 5 },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.url).toBe('http://proxy.example.com:3128');
    expect(data.url).not.toContain('user');
    expect(data.priority).toBe(5);

    const rows = await (
      holder.db.prisma.proxy as { findMany: () => Promise<Array<{ url: string }>> }
    ).findMany();
    expect(rows[0].url).not.toContain('proxy.example.com');
  });

  it('rejects invalid proxy urls', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxies',
      ...authed(),
      payload: { url: 'ftp://bad.example' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('lists proxies without leaking credentials', async () => {
    seedProxy();
    const res = await app.inject({ method: 'GET', url: '/api/proxies', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].url).toBe('http://proxy.example.com:3128');
  });

  it('gets a single proxy and 404s on missing ones', async () => {
    seedProxy();
    const res = await app.inject({ method: 'GET', url: '/api/proxies/p1', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.url).toBe('http://proxy.example.com:3128');

    const miss = await app.inject({ method: 'GET', url: '/api/proxies/nope', ...authed() });
    expect(miss.statusCode).toBe(404);
  });

  it('updates a proxy and re-encrypts the url', async () => {
    seedProxy();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/proxies/p1',
      ...authed(),
      payload: { url: 'http://new:secret@proxy.example.com:8080', enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.url).toBe('http://proxy.example.com:8080');

    const rows = await (
      holder.db.prisma.proxy as {
        findMany: () => Promise<Array<{ url: string; enabled: boolean }>>;
      }
    ).findMany();
    expect(rows[0].enabled).toBe(false);
    expect(rows[0].url).not.toContain('proxy.example.com');
  });

  it('resets the health score when a proxy is reachable', async () => {
    seedProxy({ healthScore: 40, lastFailedAt: new Date(ts).toISOString() });
    vi.mocked(testProxy).mockResolvedValueOnce(true);
    const res = await app.inject({ method: 'POST', url: '/api/proxies/p1/test', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.reachable).toBe(true);
    expect(res.json().data.healthScore).toBe(100);
    expect(res.json().data.lastFailedAt).toBeNull();
  });

  it('marks an unreachable proxy unhealthy', async () => {
    seedProxy({ healthScore: 80 });
    vi.mocked(testProxy).mockResolvedValueOnce(false);
    const res = await app.inject({ method: 'POST', url: '/api/proxies/p1/test', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.reachable).toBe(false);
    expect(res.json().data.healthScore).toBe(0);
  });

  it('deletes a proxy', async () => {
    seedProxy();
    const res = await app.inject({ method: 'DELETE', url: '/api/proxies/p1', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const miss = await app.inject({ method: 'GET', url: '/api/proxies/p1', ...authed() });
    expect(miss.statusCode).toBe(404);
  });
});
