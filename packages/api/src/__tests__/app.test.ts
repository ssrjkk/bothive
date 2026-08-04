import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ok, err, AppError, commandBus } from '@bothive/core';
import { enqueueConnect, redisConnection } from '../services/queue.js';
import { getBotMemory, clearBotMemory, deleteBotMemoryKey } from '../services/memory.js';
import { notifyScriptsChanged } from '../services/script-events.js';

const holder = vi.hoisted(() => ({ db: null as unknown as { seed: (m: string, r: unknown[]) => void; reset: () => void } }));

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
  getQueueMetrics: vi.fn(async () => ({ platform: 'x', waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 })),
  getAllQueueMetrics: vi.fn(async () => []),
  redisConnection: { publish: vi.fn(), disconnect: vi.fn() },
}));

vi.mock('../services/memory.js', () => ({
  getBotMemory: vi.fn(async () => []),
  clearBotMemory: vi.fn(async () => 0),
  deleteBotMemoryKey: vi.fn(async () => false),
}));

vi.mock('../services/script-events.js', () => ({
  notifyScriptsChanged: vi.fn(),
}));

vi.mock('../services/log-stream.js', () => ({
  logHub: { add: vi.fn(), remove: vi.fn() },
  getLogSubscriber: vi.fn(async () => undefined),
}));

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { hashPassword } from '../utils/password.js';

let app: FastifyInstance;
const dispatchSpy = vi.spyOn(commandBus, 'dispatch');

const signToken = (id: string, email = 'admin@bothive.test') => app.jwt.sign({ id, email, role: 'admin' });

const seedUser = () =>
  holder.db.seed('user', [{ id: 'u1', email: 'admin@bothive.test', name: 'Admin', role: 'admin', passwordHash: hashPassword('password123') }]);

const seedBot = (id: string, platform = 'twitch', extra: Record<string, unknown> = {}) =>
  holder.db.seed('bot', [{ id, name: `Bot ${id}`, platform, accountId: 'a1', status: 'running', config: {}, ...extra }]);

const seedAccount = () =>
  holder.db.seed('account', [{ id: 'a1', name: 'Acc', platform: 'twitch', token: 'super-secret-token-value', clientId: 'client-secret', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);

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
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'x@bothive.test', password: 'short' } });
    expect(res.statusCode).toBe(422);
  });

  it('exposes /me for the signed-in user', async () => {
    seedUser();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${signToken('u1')}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.email).toBe('admin@bothive.test');
  });

  it('rejects /me without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('changes the password with the correct current password', async () => {
    seedUser();
    const auth = { authorization: `Bearer ${signToken('u1')}` };

    const wrong = await app.inject({ method: 'PATCH', url: '/api/auth/password', headers: auth, payload: { currentPassword: 'wrong-pass', newPassword: 'newpassword1' } });
    expect(wrong.statusCode).toBe(401);

    const good = await app.inject({ method: 'PATCH', url: '/api/auth/password', headers: auth, payload: { currentPassword: 'password123', newPassword: 'newpassword1' } });
    expect(good.statusCode).toBe(200);
  });

  it('logs in with correct and rejects wrong credentials', async () => {
    seedUser();
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@bothive.test', password: 'wrong-password' } });
    expect(bad.statusCode).toBe(401);

    const good = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@bothive.test', password: 'password123' } });
    expect(good.statusCode).toBe(200);
    expect(good.json().data.token).toBeTruthy();
  });

  it('rate-limits repeated login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@bothive.test', password: 'nope' } });
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

  it('never leaks account credentials in a single bot', async () => {
    seedAccount();
    seedBot('b1');

    const res = await app.inject({ method: 'GET', url: '/api/bots/b1', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('super-secret-token-value');
  });

  it('creates a bot when the account platform matches', async () => {
    seedAccount();

    const okRes = await app.inject({ method: 'POST', url: '/api/bots', ...authed(), payload: { name: 'New Bot', platform: 'twitch', accountId: 'a1' } });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().data.platform).toBe('twitch');

    const badRes = await app.inject({ method: 'POST', url: '/api/bots', ...authed(), payload: { name: 'Bad', platform: 'telegram', accountId: 'a1' } });
    expect(badRes.statusCode).toBe(422);
  });

  it('queues start with decrypted credentials', async () => {
    seedAccount();
    seedBot('b1');

    const res = await app.inject({ method: 'POST', url: '/api/bots/b1/start', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(enqueueConnect).toHaveBeenCalledWith('b1', 'twitch', expect.objectContaining({ token: 'super-secret-token-value' }));
  });

  it('returns 404 for missing bots', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots/nope', ...authed() });
    expect(res.statusCode).toBe(404);
  });

  it('deletes a bot and enqueues disconnect', async () => {
    seedBot('b1');
    const res = await app.inject({ method: 'DELETE', url: '/api/bots/b1', ...authed() });
    expect(res.statusCode).toBe(200);
  });

  it('maps command errors to the right status code', async () => {
    seedBot('b1');
    dispatchSpy.mockResolvedValueOnce(err(AppError.validation({ name: 'taken' })));
    const res = await app.inject({ method: 'PATCH', url: '/api/bots/b1', ...authed(), payload: { name: 'x' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('queues a manual action for a bot', async () => {
    seedBot('b1');
    const res = await app.inject({ method: 'POST', url: '/api/bots/b1/action', ...authed(), payload: { type: 'sendMessage', payload: { chatId: 123, text: 'hello' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe('Action queued');
  });

  it('rejects manual actions without a type', async () => {
    seedBot('b1');
    const res = await app.inject({ method: 'POST', url: '/api/bots/b1/action', ...authed(), payload: { payload: {} } });
    expect(res.statusCode).toBe(422);
  });

  it('rejects manual actions for missing bots', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/bots/nope/action', ...authed(), payload: { type: 'sendMessage' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('bot memory', () => {
  it('lists memory entries for a bot', async () => {
    seedBot('b1');
    const entry = { key: 'visits', value: 42, ttl: 60, createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:01:00.000Z' };
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

    const res = await app.inject({ method: 'DELETE', url: '/api/bots/b1/memory/visits', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ removed: true });
  });

  it('returns 404 for memory routes of missing bots', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots/nope/memory', ...authed() });
    expect(res.statusCode).toBe(404);
  });
});

describe('scripts', () => {
  it('lists patterns with metadata and no generator', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scripts/patterns', ...authed() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.length).toBeGreaterThanOrEqual(7);
    expect(data.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(['welcome', 'auto-reply', 'command', 'counter', 'moderation', 'random-response', 'donation-thanks', 'link-guard', 'heartbeat', 'raid-host-thanks', 'threshold-alert']));
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
      payload: { botId: 'b1', name: 'Visitor counter', pattern: 'counter', params: { trigger: 'message', counterName: 'visits', reply: 'Visits: {counters.visits}' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.trigger).toBe('message');
    expect(body.config.actions[0].type).toBe('increment_counter');
    expect(notifyScriptsChanged).toHaveBeenCalled();
  });

  it('rejects generation with missing required params', async () => {
    seedBot('b1');
    const res = await app.inject({ method: 'POST', url: '/api/scripts/generate', ...authed(), payload: { botId: 'b1', name: 'X', pattern: 'auto-reply', params: {} } });
    expect(res.statusCode).toBe(422);
  });

  it('rejects unknown patterns', async () => {
    seedBot('b1');
    const res = await app.inject({ method: 'POST', url: '/api/scripts/generate', ...authed(), payload: { botId: 'b1', name: 'X', pattern: 'nope', params: {} } });
    expect(res.statusCode).toBe(404);
  });

  it('supports manual script CRUD', async () => {
    seedBot('b1');
    const created = await app.inject({ method: 'POST', url: '/api/scripts', ...authed(), payload: { botId: 'b1', name: 'Manual', trigger: 'message', config: { actions: [] } } });
    expect(created.statusCode).toBe(200);
    const scriptId = created.json().data.id;

    const patched = await app.inject({ method: 'PATCH', url: `/api/scripts/${scriptId}`, ...authed(), payload: { enabled: false } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.enabled).toBe(false);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/scripts/${scriptId}`, ...authed() });
    expect(deleted.statusCode).toBe(200);
  });

  it('publishes a test trigger for a script', async () => {
    seedBot('b1');
    const created = await app.inject({ method: 'POST', url: '/api/scripts', ...authed(), payload: { botId: 'b1', name: 'Testable', trigger: 'message', config: { actions: [] } } });
    const scriptId = created.json().data.id;

    const res = await app.inject({ method: 'POST', url: `/api/scripts/${scriptId}/test`, ...authed(), payload: { sample: { text: 'hello' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(redisConnection.publish).toHaveBeenCalledWith('bothive:script:trigger', JSON.stringify({ botId: 'b1', scriptId, sample: { text: 'hello' } }));
  });

  it('rejects test trigger for a missing script', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/scripts/nope/test', ...authed() });
    expect(res.statusCode).toBe(404);
  });

  it('rejects invalid test sample payload', async () => {
    seedBot('b1');
    const created = await app.inject({ method: 'POST', url: '/api/scripts', ...authed(), payload: { botId: 'b1', name: 'Testable', trigger: 'message', config: { actions: [] } } });
    const scriptId = created.json().data.id;

    const res = await app.inject({ method: 'POST', url: `/api/scripts/${scriptId}/test`, ...authed(), payload: { sample: ['not', 'object'] } });
    expect(res.statusCode).toBe(422);
    expect(redisConnection.publish).not.toHaveBeenCalled();
  });

  it('clones a script as a disabled copy', async () => {
    seedBot('b1');
    const created = await app.inject({ method: 'POST', url: '/api/scripts', ...authed(), payload: { botId: 'b1', name: 'Original', trigger: 'message', config: { actions: [{ type: 'reply', payload: { text: 'hi' } }] }, enabled: true } });
    const scriptId = created.json().data.id;

    const res = await app.inject({ method: 'POST', url: `/api/scripts/${scriptId}/clone`, ...authed() });
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

  it('rejects script configs with catastrophic regex filters', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: { botId: 'b1', name: 'ReDoS', trigger: 'message', config: { filters: [{ type: 'regex', value: '^([a-z]+)+$' }], actions: [] } },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects script configs with sandbox-escaping custom code', async () => {
    seedBot('b1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/scripts',
      ...authed(),
      payload: { botId: 'b1', name: 'Esc', trigger: 'message', config: { actions: [{ type: 'custom', payload: { code: 'this.constructor.constructor("return process")()' } }] } },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects script config updates that fail safety checks', async () => {
    seedBot('b1');
    const created = await app.inject({ method: 'POST', url: '/api/scripts', ...authed(), payload: { botId: 'b1', name: 'Safe', trigger: 'message', config: { actions: [] } } });
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
    const res = await app.inject({ method: 'POST', url: '/api/bulk/bots', ...authed(), payload: { ids: ['b1'], action: 'explode' } });
    expect(res.statusCode).toBe(400);
  });

  it('runs a bulk restart', async () => {
    seedAccount();
    seedBot('b1');
    const res = await app.inject({ method: 'POST', url: '/api/bulk/bots', ...authed(), payload: { ids: ['b1', 'missing'], action: 'restart' } });
    expect(res.statusCode).toBe(200);
    const results = res.json().data;
    expect(results[0].status).toBe('queued');
    expect(results[1]).toEqual({ id: 'missing', status: 'error', error: 'not found' });
  });

  it('bulk enables, disables and deletes scripts', async () => {
    seedBot('b1');
    const created = await app.inject({ method: 'POST', url: '/api/scripts', ...authed(), payload: { botId: 'b1', name: 'A', trigger: 'message', config: { actions: [] }, enabled: false } });
    const scriptId = created.json().data.id;

    const enabled = await app.inject({ method: 'POST', url: '/api/bulk/scripts', ...authed(), payload: { ids: [scriptId], action: 'enable' } });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().data[0].status).toBe('updated');
    expect(notifyScriptsChanged).toHaveBeenCalled();

    const deleted = await app.inject({ method: 'POST', url: '/api/bulk/scripts', ...authed(), payload: { ids: [scriptId], action: 'delete' } });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data[0].status).toBe('deleted');

    const gone = await app.inject({ method: 'GET', url: `/api/scripts/${scriptId}`, ...authed() });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects invalid bulk script actions', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/bulk/scripts', ...authed(), payload: { ids: ['x'], action: 'explode' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects empty bulk script ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/bulk/scripts', ...authed(), payload: { ids: [], action: 'enable' } });
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
  it('requires authentication when no token is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(401);
  });

  it('serves metrics to authenticated users', async () => {
    holder.db.seed('bot', [{ id: 'm1', name: 'M', platform: 'twitch', accountId: 'a1', status: 'running', config: {} }]);
    const res = await app.inject({ method: 'GET', url: '/metrics', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('bothive_bots_total');
  });

  it('accepts a configured bearer token', async () => {
    process.env.METRICS_TOKEN = 'metrics-bearer-token';
    try {
      const res = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer metrics-bearer-token' } });
      expect(res.statusCode).toBe(200);
      const bad = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer wrong' } });
      expect(bad.statusCode).toBe(401);
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });
});

describe('logs and stats', () => {
  it('exports logs as CSV', async () => {
    holder.db.seed('log', [
      { id: 'l1', botId: 'b1', level: 'info', message: 'Hello, "world"', meta: { a: 1 }, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/logs/export', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('"id","botId","level","message","meta","createdAt"');
    expect(res.body).toContain('Hello, ""world""');
  });

  it('filters log export by bot and level', async () => {
    holder.db.seed('log', [
      { id: 'l1', botId: 'b1', level: 'info', message: 'keep', meta: {}, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'l2', botId: 'b2', level: 'error', message: 'drop', meta: {}, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/logs/export?botId=b1&level=info', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('keep');
    expect(res.body).not.toContain('drop');
  });

  it('lists logs filtered by bot', async () => {
    holder.db.seed('log', [
      { id: 'l1', botId: 'b1', level: 'info', message: 'hello', createdAt: new Date().toISOString() },
      { id: 'l2', botId: 'b2', level: 'error', message: 'boom', createdAt: new Date().toISOString() },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/logs?botId=b1', ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.total).toBe(1);
    expect(res.json().data.logs[0].message).toBe('hello');
  });

  it('returns aggregated stats', async () => {
    holder.db.seed('account', [{ id: 'a1', name: 'A', platform: 'twitch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
    holder.db.seed('bot', [
      { id: 'b1', name: 'B1', platform: 'twitch', accountId: 'a1', status: 'running', config: {} },
      { id: 'b2', name: 'B2', platform: 'telegram', accountId: 'a1', status: 'idle', config: {} },
    ]);
    holder.db.seed('script', [
      { id: 's1', botId: 'b1', name: 'S1', trigger: 'message', config: {}, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 's2', botId: 'b2', name: 'S2', trigger: 'follow', config: {}, enabled: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    holder.db.seed('webhook', [
      { id: 'w1', name: 'W1', url: 'https://x', events: ['message'], enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    holder.db.seed('log', [
      { id: 'l1', botId: 'b1', level: 'error', message: 'boom', createdAt: new Date().toISOString() },
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

  it('creates, lists, updates and deletes a webhook', async () => {
    seedBot('b1');
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: { name: 'Alerts', url: 'https://example.com/hook', events: ['follow', 'donation'], botId: 'b1', secret: 'hmac-secret' },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().data.id;
    expect(created.json().data.enabled).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/api/webhooks', ...authed() });
    expect(list.json().data.length).toBe(1);
    expect(list.json().data[0].name).toBe('Alerts');

    const patched = await app.inject({ method: 'PATCH', url: `/api/webhooks/${id}`, ...authed(), payload: { enabled: false, events: ['message'] } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.enabled).toBe(false);
    expect(patched.json().data.events).toEqual(['message']);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/webhooks/${id}`, ...authed() });
    expect(deleted.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/webhooks', ...authed() });
    expect(after.json().data.length).toBe(0);
  });

  it('rejects invalid urls and events', async () => {
    const badUrl = await app.inject({ method: 'POST', url: '/api/webhooks', ...authed(), payload: { name: 'X', url: 'not-a-url', events: ['message'] } });
    expect(badUrl.statusCode).toBe(422);

    const badEvents = await app.inject({ method: 'POST', url: '/api/webhooks', ...authed(), payload: { name: 'X', url: 'https://example.com', events: ['mystery'] } });
    expect(badEvents.statusCode).toBe(422);

    const emptyEvents = await app.inject({ method: 'POST', url: '/api/webhooks', ...authed(), payload: { name: 'X', url: 'https://example.com', events: [] } });
    expect(emptyEvents.statusCode).toBe(422);
  });

  it('rejects webhooks pointing at missing bots', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/webhooks', ...authed(), payload: { name: 'X', url: 'https://example.com', events: ['message'], botId: 'ghost' } });
    expect(res.statusCode).toBe(422);
  });

  it('rejects webhooks targeting private or loopback addresses', async () => {
    for (const url of ['http://127.0.0.1:3000/x', 'http://10.0.0.5/x', 'http://192.168.1.10/x', 'http://169.254.169.254/latest/meta-data', 'http://localhost:8080/x', 'http://foo.local/x']) {
      const res = await app.inject({ method: 'POST', url: '/api/webhooks', ...authed(), payload: { name: 'X', url, events: ['message'] } });
      expect(res.statusCode).toBe(422);
    }
  });

  it('reports a failed test delivery', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/webhooks', ...authed(), payload: { name: 'X', url: 'https://example.com/nope', events: ['message'] } });
    const id = created.json().data.id;
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.inject({ method: 'POST', url: `/api/webhooks/${id}/test`, ...authed() });
    vi.unstubAllGlobals();
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('WEBHOOK_DELIVERY_FAILED');
  });

  it('delivers a test with a custom sample and event type, recording the delivery', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/webhooks', ...authed(), payload: { name: 'X', url: 'https://example.com/hook', events: ['message'] } });
    const id = created.json().data.id;

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.inject({ method: 'POST', url: `/api/webhooks/${id}/test`, ...authed(), payload: { eventType: 'follow', sample: { username: 'alice' } } });
    vi.unstubAllGlobals();

    expect(res.statusCode).toBe(200);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.type).toBe('follow');
    expect(sentBody.payload.username).toBe('alice');

    const list = await app.inject({ method: 'GET', url: '/api/webhooks', ...authed() });
    const wh = list.json().data.find((w: { id: string }) => w.id === id);
    expect(wh.lastStatus).toBe('ok');
    expect(wh.lastDeliveredAt).toBeTruthy();
  });

  it('rejects a test payload that is not an object', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/webhooks', ...authed(), payload: { name: 'X', url: 'https://example.com/hook', events: ['message'] } });
    const id = created.json().data.id;
    const res = await app.inject({ method: 'POST', url: `/api/webhooks/${id}/test`, ...authed(), payload: { sample: 'nope' } });
    expect(res.statusCode).toBe(422);
  });

  it('never exposes the HMAC secret to clients', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      ...authed(),
      payload: { name: 'Alerts', url: 'https://example.com/hook', events: ['message'], secret: 'top-secret-hmac' },
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
      payload: { name: 'X', url: 'https://example.com/hook', events: ['message'], secret: 'keep-me' },
    });
    const id = created.json().data.id;

    const patched = await app.inject({ method: 'PATCH', url: `/api/webhooks/${id}`, ...authed(), payload: { enabled: false } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.hasSecret).toBe(true);
    expect(patched.json().data.secret).toBeUndefined();

    const webhookModel = (holder.db as unknown as { prisma: { webhook: { findMany: (a?: unknown) => Promise<Array<Record<string, unknown>>> } } }).prisma.webhook;
    const stored = (await webhookModel.findMany()).find((w) => w.id === id);
    expect(stored?.secret).toBe('keep-me');
  });
});

describe('backup', () => {
  const ts = new Date().toISOString();

  it('exports accounts, bots and scripts with consistent refs', async () => {
    holder.db.seed('account', [
      { id: 'a1', name: 'Main', platform: 'twitch', token: 'super-secret-token-value', createdAt: ts, updatedAt: ts },
      { id: 'a2', name: 'Tg', platform: 'telegram', token: 'tg-token', createdAt: ts, updatedAt: ts },
    ]);
    holder.db.seed('bot', [
      { id: 'b1', name: 'B1', platform: 'twitch', accountId: 'a1', status: 'running', config: { channel: '#x' }, createdAt: ts, updatedAt: ts },
      { id: 'b2', name: 'B2', platform: 'telegram', accountId: 'a2', status: 'idle', config: {}, createdAt: ts, updatedAt: ts },
    ]);
    holder.db.seed('script', [
      { id: 's1', botId: 'b1', name: 'Greeter', trigger: 'follow', config: {}, enabled: true, createdAt: ts, updatedAt: ts },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/backup/export', ...authed() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.app).toBe('bothive');
    expect(data.accounts.length).toBe(2);
    expect(data.accounts[0].token).toBe('super-secret-token-value');
    expect(data.bots[0]).toEqual(expect.objectContaining({ name: 'B1', accountRef: 0, config: { channel: '#x' } }));
    expect(data.scripts[0]).toEqual(expect.objectContaining({ botRef: 0, name: 'Greeter', trigger: 'follow' }));
  });

  it('imports a full backup', async () => {
    const payload = {
      accounts: [
        { name: 'Main', platform: 'twitch', token: 'new-token' },
        { name: 'Tg', platform: 'telegram', token: 'tg-token' },
      ],
      bots: [
        { name: 'B1', platform: 'twitch', accountRef: 0, config: { channel: '#x' } },
      ],
      scripts: [
        { botRef: 0, name: 'Greeter', trigger: 'follow', config: { actions: [] }, enabled: true },
      ],
    };
    const res = await app.inject({ method: 'POST', url: '/api/backup/import', ...authed(), payload });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.accounts.created).toBe(2);
    expect(data.bots.created).toBe(1);
    expect(data.scripts.created).toBe(1);

    const bots = await app.inject({ method: 'GET', url: '/api/bots', ...authed() });
    expect(bots.json().data.length).toBe(1);
    expect(bots.json().data[0].config.channel).toBe('#x');
  });

  it('updates existing accounts, bots and scripts on re-import', async () => {
    holder.db.seed('account', [{ id: 'a1', name: 'Main', platform: 'twitch', token: 'old', createdAt: ts, updatedAt: ts }]);
    holder.db.seed('bot', [{ id: 'b1', name: 'B1', platform: 'twitch', accountId: 'a1', status: 'idle', config: {}, createdAt: ts, updatedAt: ts }]);
    holder.db.seed('script', [{ id: 's1', botId: 'b1', name: 'Greeter', trigger: 'follow', config: {}, enabled: true, createdAt: ts, updatedAt: ts }]);

    const payload = {
      accounts: [{ name: 'Main', platform: 'twitch', token: 'rotated' }],
      bots: [{ name: 'B1', platform: 'twitch', accountRef: 0, config: { channel: '#y' } }],
      scripts: [{ botRef: 0, name: 'Greeter', trigger: 'message', config: {}, enabled: false }],
    };
    const res = await app.inject({ method: 'POST', url: '/api/backup/import', ...authed(), payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      accounts: { created: 0, updated: 1 },
      bots: { created: 0, updated: 1 },
      scripts: { created: 0, updated: 1 },
    });
  });

  it('rejects malformed backups', async () => {
    const noArrays = await app.inject({ method: 'POST', url: '/api/backup/import', ...authed(), payload: { accounts: [], bots: [] } });
    expect(noArrays.statusCode).toBe(422);

    const badRef = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload: { accounts: [{ name: 'A', platform: 'twitch' }], bots: [{ name: 'B', platform: 'twitch', accountRef: 5 }], scripts: [] },
    });
    expect(badRef.statusCode).toBe(422);
  });

  it('rejects oversized backups', async () => {
    const payload = {
      accounts: Array.from({ length: 1001 }, (_, i) => ({ name: `A${i}`, platform: 'twitch' })),
      bots: [],
      scripts: [],
    };
    const res = await app.inject({ method: 'POST', url: '/api/backup/import', ...authed(), payload });
    expect(res.statusCode).toBe(422);
  });

  it('rejects scripts with unsafe custom code on import', async () => {
    const payload = {
      accounts: [{ name: 'A', platform: 'twitch' }],
      bots: [{ name: 'B', platform: 'twitch', accountRef: 0, config: {} }],
      scripts: [{
        botRef: 0,
        name: 'Bad',
        trigger: 'message',
        config: { actions: [{ type: 'custom', payload: { code: 'ctx.constructor.constructor("return process")()' } }] },
        enabled: true,
      }],
    };
    const res = await app.inject({ method: 'POST', url: '/api/backup/import', ...authed(), payload });
    expect(res.statusCode).toBe(422);
  });

  it('rejects scripts with disallowed webhook URLs on import', async () => {
    const payload = {
      accounts: [{ name: 'A', platform: 'twitch' }],
      bots: [{ name: 'B', platform: 'twitch', accountRef: 0, config: {} }],
      scripts: [{
        botRef: 0,
        name: 'Bad',
        trigger: 'message',
        config: { actions: [{ type: 'webhook', payload: { url: 'http://127.0.0.1:9999/x' } }] },
        enabled: true,
      }],
    };
    const res = await app.inject({ method: 'POST', url: '/api/backup/import', ...authed(), payload });
    expect(res.statusCode).toBe(422);
  });

  it('encrypts plaintext credentials on import and keeps round-trips encrypted', async () => {
    const plaintext = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      ...authed(),
      payload: { accounts: [{ name: 'Plain', platform: 'twitch', token: 'plain-token-value' }], bots: [], scripts: [] },
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
