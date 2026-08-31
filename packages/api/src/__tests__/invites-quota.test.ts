import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ok, commandBus } from '@bothive/core';
import { createTestDb } from './helpers/test-db.js';
import type { MockDb } from './helpers/mock-db.js';

const holder = vi.hoisted(() => ({ db: null as unknown as MockDb }));
holder.db = (await createTestDb()) as unknown as MockDb;

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { hashPassword } from '../utils/password.js';

let app: FastifyInstance;
const dispatchSpy = vi.spyOn(commandBus, 'dispatch');

const seededHash = await hashPassword('password123');
const ts = new Date('2026-01-01T00:00:00.000Z').toISOString();

const seedUsers = async () =>
  await holder.db.seed('user', [
    {
      id: 'u1',
      email: 'admin@bothive.test',
      name: 'Admin',
      role: 'admin',
      passwordHash: seededHash,
    },
    {
      id: 'u2',
      email: 'owner-b@bothive.test',
      name: 'Owner B',
      role: 'admin',
      passwordHash: seededHash,
    },
    {
      id: 'u3',
      email: 'viewer@bothive.test',
      name: 'Viewer',
      role: 'viewer',
      passwordHash: seededHash,
    },
  ]);

const bearer = (id: string) => ({
  headers: {
    authorization: `Bearer ${app.jwt.sign({ id, email: `${id}@bothive.test`, role: 'admin' })}`,
  },
});

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-0123456789abcdef';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  app = await buildApp();
  dispatchSpy.mockResolvedValue(ok({}));
});

beforeEach(async () => {
  await holder.db.reset();
  await seedUsers();
  vi.clearAllMocks();
  dispatchSpy.mockResolvedValue(ok({}));
});

afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('invite system', () => {
  it('admin creates an invite and the token can be redeemed to create a user', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/invites',
      payload: { email: 'newuser@bothive.test', role: 'viewer' },
      ...bearer('u1'),
    });
    expect(created.statusCode).toBe(200);
    const invite = created.json().data;
    expect(invite.token).toBeTruthy();
    expect(invite.redeemUrl).toBe(`/invite/${invite.token}`);

    const redeemed = await app.inject({
      method: 'POST',
      url: '/api/auth/invite/redeem',
      payload: { token: invite.token, password: 'freshpass123' },
    });
    expect(redeemed.statusCode).toBe(200);
    const body = redeemed.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe('newuser@bothive.test');
    expect(body.data.user).not.toHaveProperty('passwordHash');
    expect(redeemed.headers['set-cookie']).toBeTruthy();

    // The new user can log in with the password they chose.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'newuser@bothive.test', password: 'freshpass123' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('rejects redeeming an invite with an invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/invite/redeem',
      payload: { token: 'nope', password: 'whatever123' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects redeeming the same invite twice (410 gone)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/invites',
      payload: { email: 'onetimer@bothive.test' },
      ...bearer('u1'),
    });
    const token = created.json().data.token;

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/invite/redeem',
      payload: { token, password: 'password123' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/invite/redeem',
      payload: { token, password: 'password456' },
    });
    expect(second.statusCode).toBe(410);
    expect(second.json().error.code).toBe('GONE');
  });

  it('rejects an expired invite', async () => {
    await holder.db.seed('invite', [
      {
        id: 'inv1',
        email: 'late@bothive.test',
        token: 'expired-token-1',
        role: 'viewer',
        createdById: 'u1',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        createdAt: ts,
      },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/invite/redeem',
      payload: { token: 'expired-token-1', password: 'whatever123' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('GONE');
  });

  it('returns 422 when token or password is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/invite/redeem',
      payload: { token: 'x' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('admin can list pending invites and revoke one', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/invites',
      payload: { email: 'listme@bothive.test' },
      ...bearer('u1'),
    });
    const id = created.json().data.id;

    const list = await app.inject({ method: 'GET', url: '/api/auth', ...bearer('u1') });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((i: { id: string }) => i.id === id)).toBe(true);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/auth/invites/${id}`,
      ...bearer('u1'),
    });
    expect(del.statusCode).toBe(200);

    const list2 = await app.inject({ method: 'GET', url: '/api/auth', ...bearer('u1') });
    expect(list2.json().data.some((i: { id: string }) => i.id === id)).toBe(false);
  });

  it('non-admins cannot create or list invites', async () => {
    const viewerToken = app.jwt.sign({ id: 'u3', email: 'viewer@bothive.test', role: 'viewer' });
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/auth/invites',
      payload: { email: 'sneaky@bothive.test' },
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(createRes.statusCode).toBe(403);

    await app.inject({
      method: 'POST',
      url: '/api/auth/invites',
      payload: { email: 'sneaky@bothive.test' },
      ...bearer('u1'),
    });

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/auth',
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(listRes.statusCode).toBe(403);
  });

  it('rejects duplicate active invites and already-registered emails', async () => {
    await holder.db.seed('invite', [
      {
        id: 'inv1',
        email: 'dup@bothive.test',
        token: 'dup-token',
        role: 'viewer',
        createdById: 'u1',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        createdAt: ts,
      },
    ]);
    const dup = await app.inject({
      method: 'POST',
      url: '/api/auth/invites',
      payload: { email: 'dup@bothive.test' },
      ...bearer('u1'),
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CONFLICT');

    const exists = await app.inject({
      method: 'POST',
      url: '/api/auth/invites',
      payload: { email: 'admin@bothive.test' },
      ...bearer('u1'),
    });
    expect(exists.statusCode).toBe(409);
    expect(exists.json().error.code).toBe('CONFLICT');
  });
});

describe('resource quotas', () => {
  it('returns 429 QUOTA_EXCEEDED when an owner hits the accounts cap', async () => {
    const accounts = Array.from({ length: 20 }, (_, i) => ({
      id: `quota-acc-${i}`,
      name: `acc${i}`,
      platform: 'twitch',
      token: `tok${i}`,
      ownerId: 'u1',
      createdAt: ts,
      updatedAt: ts,
    }));
    await holder.db.seed('account', accounts);

    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { name: 'too-many', platform: 'twitch' },
      ...bearer('u1'),
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
    expect(res.json().error.details).toMatchObject({
      resource: 'accounts',
      current: 20,
      limit: 20,
    });
  });

  it('quota is enforced per owner, not globally', async () => {
    // u1 is at cap; u2 has room and can still create.
    const accounts = Array.from({ length: 20 }, (_, i) => ({
      id: `quota-acc-${i}`,
      name: `acc${i}`,
      platform: 'twitch',
      token: `tok${i}`,
      ownerId: 'u1',
      createdAt: ts,
      updatedAt: ts,
    }));
    await holder.db.seed('account', accounts);

    const forU1 = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { name: 'u1-over', platform: 'twitch' },
      ...bearer('u1'),
    });
    expect(forU1.statusCode).toBe(429);

    const u2Token = app.jwt.sign({ id: 'u2', email: 'owner-b@bothive.test', role: 'admin' });
    const forU2 = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { name: 'u2-fine', platform: 'telegram' },
      headers: { authorization: `Bearer ${u2Token}` },
    });
    expect(forU2.statusCode).toBe(200);
    expect(forU2.json().data.name).toBe('u2-fine');
  });
});
