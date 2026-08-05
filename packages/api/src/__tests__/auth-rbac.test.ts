import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ok, commandBus } from '@bothive/core';
import { redisConnection } from '../services/queue.js';

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
  getFailedJobs: vi.fn(async () => []),
  redisConnection: { publish: vi.fn(), disconnect: vi.fn(), keys: vi.fn(async () => []), get: vi.fn(async () => null) },
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

const sign = (id: string, role: string, email = `${id}@bothive.test`) => app.jwt.sign({ id, email, role }, { expiresIn: '24h' });

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

const seedUsers = (users: Array<{ id: string; email: string; role: string }>) =>
  holder.db.seed(
    'user',
    users.map((u) => ({ id: u.id, email: u.email, name: u.name ?? u.email.split('@')[0], role: u.role, passwordHash: hashPassword('password123') })),
  );

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe('RBAC', () => {
  it('allows admins full access and viewers read-only access', async () => {
    seedUsers([
      { id: 'admin', email: 'admin@bothive.test', role: 'admin' },
      { id: 'viewer', email: 'viewer@bothive.test', role: 'viewer' },
    ]);

    const adminList = await app.inject({ method: 'GET', url: '/api/bots', ...bearer(sign('admin', 'admin')) });
    expect(adminList.statusCode).toBe(200);

    const viewerList = await app.inject({ method: 'GET', url: '/api/bots', ...bearer(sign('viewer', 'viewer')) });
    expect(viewerList.statusCode).toBe(200);

    const adminCreate = await app.inject({ method: 'POST', url: '/api/bots', ...bearer(sign('admin', 'admin')), payload: { name: 'X', platform: 'twitch', accountId: 'a1' } });
    expect(adminCreate.statusCode).toBe(422);

    const viewerCreate = await app.inject({ method: 'POST', url: '/api/bots', ...bearer(sign('viewer', 'viewer')), payload: { name: 'X', platform: 'twitch', accountId: 'a1' } });
    expect(viewerCreate.statusCode).toBe(403);
    expect(viewerCreate.json().error.code).toBe('FORBIDDEN');
  });

  it('denies unknown roles', async () => {
    seedUsers([{ id: 'x', email: 'x@bothive.test', role: 'superuser' }]);
    const res = await app.inject({ method: 'GET', url: '/api/bots', ...bearer(sign('x', 'superuser')) });
    expect(res.statusCode).toBe(403);
  });

  it('uses the database role, not the (possibly stale) JWT role claim', async () => {
    // Token claims "admin" but the user has since been demoted to viewer.
    seedUsers([{ id: 'demoted', email: 'demoted@bothive.test', role: 'viewer' }]);
    const staleAdminToken = sign('demoted', 'admin');

    const read = await app.inject({ method: 'GET', url: '/api/bots', ...bearer(staleAdminToken) });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({ method: 'POST', url: '/api/bots', ...bearer(staleAdminToken), payload: { name: 'X', platform: 'twitch', accountId: 'a1' } });
    expect(write.statusCode).toBe(403);
  });

  it('rejects tokens for deleted users', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots', ...bearer(sign('ghost', 'admin')) });
    expect(res.statusCode).toBe(401);
  });

  it('lists users only for admins', async () => {
    seedUsers([{ id: 'admin', email: 'admin@bothive.test', role: 'admin' }]);

    const admin = await app.inject({ method: 'GET', url: '/api/auth/users', ...bearer(sign('admin', 'admin')) });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().data.length).toBe(1);

    seedUsers([
      { id: 'admin', email: 'admin@bothive.test', role: 'admin' },
      { id: 'viewer', email: 'viewer@bothive.test', role: 'viewer' },
    ]);
    const viewer = await app.inject({ method: 'GET', url: '/api/auth/users', ...bearer(sign('viewer', 'viewer')) });
    expect(viewer.statusCode).toBe(403);
  });

  it('updates roles as an admin', async () => {
    seedUsers([
      { id: 'admin', email: 'admin@bothive.test', role: 'admin' },
      { id: 'v1', email: 'v1@bothive.test', role: 'admin' },
    ]);

    const res = await app.inject({ method: 'PATCH', url: '/api/auth/users/v1/role', ...bearer(sign('admin', 'admin')), payload: { role: 'viewer' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe('viewer');
  });

  it('refuses to demote the last admin', async () => {
    seedUsers([{ id: 'admin', email: 'admin@bothive.test', role: 'admin' }]);

    const res = await app.inject({ method: 'PATCH', url: '/api/auth/users/admin/role', ...bearer(sign('admin', 'admin')), payload: { role: 'viewer' } });
    expect(res.statusCode).toBe(409);
  });

  it('rejects role changes from a viewer', async () => {
    seedUsers([
      { id: 'admin', email: 'admin@bothive.test', role: 'admin' },
      { id: 'viewer', email: 'viewer@bothive.test', role: 'viewer' },
    ]);

    const res = await app.inject({ method: 'PATCH', url: '/api/auth/users/admin/role', ...bearer(sign('viewer', 'viewer')), payload: { role: 'viewer' } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects invalid roles and missing users', async () => {
    seedUsers([{ id: 'admin', email: 'admin@bothive.test', role: 'admin' }]);

    const badRole = await app.inject({ method: 'PATCH', url: '/api/auth/users/admin/role', ...bearer(sign('admin', 'admin')), payload: { role: 'root' } });
    expect(badRole.statusCode).toBe(422);

    const missing = await app.inject({ method: 'PATCH', url: '/api/auth/users/nope/role', ...bearer(sign('admin', 'admin')), payload: { role: 'viewer' } });
    expect(missing.statusCode).toBe(404);
  });

  it('creates users as an admin, defaulting to the viewer role', async () => {
    seedUsers([{ id: 'admin', email: 'admin@bothive.test', role: 'admin' }]);

    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/users',
      ...bearer(sign('admin', 'admin')),
      payload: { email: 'new@bothive.test', password: 'password123' },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.role).toBe('viewer');
    expect(created.json().data.passwordHash).toBeUndefined();

    const withRole = await app.inject({
      method: 'POST',
      url: '/api/auth/users',
      ...bearer(sign('admin', 'admin')),
      payload: { email: 'op@bothive.test', password: 'password123', role: 'admin', name: 'Operator' },
    });
    expect(withRole.statusCode).toBe(200);
    expect(withRole.json().data.role).toBe('admin');
    expect(withRole.json().data.name).toBe('Operator');
  });

  it('rejects user creation from a viewer', async () => {
    seedUsers([
      { id: 'admin', email: 'admin@bothive.test', role: 'admin' },
      { id: 'viewer', email: 'viewer@bothive.test', role: 'viewer' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/users',
      ...bearer(sign('viewer', 'viewer')),
      payload: { email: 'new@bothive.test', password: 'password123' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects user creation with duplicate email, invalid input or bad role', async () => {
    seedUsers([{ id: 'admin', email: 'admin@bothive.test', role: 'admin' }]);
    const admin = bearer(sign('admin', 'admin'));

    const dup = await app.inject({
      method: 'POST',
      url: '/api/auth/users',
      ...admin,
      payload: { email: 'admin@bothive.test', password: 'password123' },
    });
    expect(dup.statusCode).toBe(409);

    const badInput = await app.inject({ method: 'POST', url: '/api/auth/users', ...admin, payload: { email: 'not-an-email', password: 'x' } });
    expect(badInput.statusCode).toBe(422);

    const badRole = await app.inject({
      method: 'POST',
      url: '/api/auth/users',
      ...admin,
      payload: { email: 'x@bothive.test', password: 'password123', role: 'root' },
    });
    expect(badRole.statusCode).toBe(422);
  });

  it('deletes users as an admin', async () => {
    seedUsers([
      { id: 'admin', email: 'admin@bothive.test', role: 'admin' },
      { id: 'v1', email: 'v1@bothive.test', role: 'viewer' },
    ]);

    const res = await app.inject({ method: 'DELETE', url: '/api/auth/users/v1', ...bearer(sign('admin', 'admin')) });
    expect(res.statusCode).toBe(200);

    const deletedToken = sign('v1', 'viewer');
    const gone = await app.inject({ method: 'GET', url: '/api/auth/me', ...bearer(deletedToken) });
    expect(gone.statusCode).toBe(401);
  });

  it('prevents self-deletion, deleting the last admin and viewer deletions', async () => {
    seedUsers([
      { id: 'admin', email: 'admin@bothive.test', role: 'admin' },
      { id: 'viewer', email: 'viewer@bothive.test', role: 'viewer' },
    ]);
    const admin = bearer(sign('admin', 'admin'));

    const self = await app.inject({ method: 'DELETE', url: '/api/auth/users/admin', ...admin });
    expect(self.statusCode).toBe(400);

    const missing = await app.inject({ method: 'DELETE', url: '/api/auth/users/nope', ...admin });
    expect(missing.statusCode).toBe(404);

    const byViewer = await app.inject({ method: 'DELETE', url: '/api/auth/users/admin', ...bearer(sign('viewer', 'viewer')) });
    expect(byViewer.statusCode).toBe(403);
  });
});

describe('cookie auth', () => {
  it('sets an HttpOnly cookie on login and clears it on logout', async () => {
    holder.db.seed('user', [{ id: 'u1', email: 'admin@bothive.test', name: 'Admin', role: 'admin', passwordHash: hashPassword('password123') }]);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@bothive.test', password: 'password123' } });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers['set-cookie'] as string;
    expect(cookie).toContain('bothive_token=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('authenticates requests using the cookie alone', async () => {
    seedUsers([{ id: 'u1', email: 'admin@bothive.test', role: 'admin' }]);
    const token = sign('u1', 'admin');

    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `bothive_token=${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.email).toBe('admin@bothive.test');
  });

  it('does not honor cookies when an explicit Authorization header is present', async () => {
    seedUsers([
      { id: 'u1', email: 'admin@bothive.test', role: 'admin' },
      { id: 'viewer', email: 'viewer@bothive.test', role: 'viewer' },
    ]);
    const adminToken = sign('u1', 'admin');
    const viewerToken = sign('viewer', 'viewer');

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${viewerToken}`, cookie: `bothive_token=${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.email).toBe('viewer@bothive.test');
  });
});

describe('registration policy', () => {
  it('rejects registration when ALLOW_REGISTRATION is false', async () => {
    process.env.ALLOW_REGISTRATION = 'false';
    try {
      const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'admin@bothive.test', password: 'password123' } });
      expect(res.statusCode).toBe(403);
    } finally {
      delete process.env.ALLOW_REGISTRATION;
    }
  });
});

describe('JSON body depth', () => {
  it('accepts shallow payloads', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@bothive.test', password: 'password123' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects deeply nested JSON bodies with 400', async () => {
    let nested: unknown = { leaf: true };
    for (let i = 0; i < 50; i++) nested = { nested };
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(nested),
    });
    expect(res.statusCode).toBe(400);
  });
});
