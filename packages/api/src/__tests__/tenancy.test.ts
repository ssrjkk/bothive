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
    { id: 'u1', email: 'owner-a@bothive.test', name: 'A', role: 'admin', passwordHash: seededHash },
    { id: 'u2', email: 'owner-b@bothive.test', name: 'B', role: 'admin', passwordHash: seededHash },
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

describe('tenant isolation', () => {
  it('lists only the caller-owned accounts', async () => {
    await holder.db.seed('account', [
      {
        id: 'a1',
        name: 'A-acc',
        platform: 'twitch',
        token: 'x',
        ownerId: 'u1',
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: 'a2',
        name: 'B-acc',
        platform: 'telegram',
        token: 'y',
        ownerId: 'u2',
        createdAt: ts,
        updatedAt: ts,
      },
    ]);

    const resA = await app.inject({ method: 'GET', url: '/api/accounts', ...bearer('u1') });
    expect(resA.statusCode).toBe(200);
    const namesA = resA.json().data.map((a: { name: string }) => a.name);
    expect(namesA).toEqual(['A-acc']);

    const resB = await app.inject({ method: 'GET', url: '/api/accounts', ...bearer('u2') });
    expect(resB.statusCode).toBe(200);
    const namesB = resB.json().data.map((a: { name: string }) => a.name);
    expect(namesB).toEqual(['B-acc']);
  });

  it('rejects reading another owners account with 404 (no existence leak)', async () => {
    await holder.db.seed('account', [
      {
        id: 'a1',
        name: 'A-acc',
        platform: 'twitch',
        token: 'x',
        ownerId: 'u1',
        createdAt: ts,
        updatedAt: ts,
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/accounts/a1', ...bearer('u2') });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects updating or deleting another owners account with 404', async () => {
    await holder.db.seed('account', [
      {
        id: 'a1',
        name: 'A-acc',
        platform: 'twitch',
        token: 'x',
        ownerId: 'u1',
        createdAt: ts,
        updatedAt: ts,
      },
    ]);

    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/accounts/a1',
      payload: { name: 'hijacked' },
      ...bearer('u2'),
    });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: '/api/accounts/a1', ...bearer('u2') });
    expect(del.statusCode).toBe(404);

    const still = await app.inject({ method: 'GET', url: '/api/accounts/a1', ...bearer('u1') });
    expect(still.statusCode).toBe(200);
    expect(still.json().data.name).toBe('A-acc');
  });

  it('scopes bots to their owner across list, single-read, patch and delete', async () => {
    await holder.db.seed('account', [
      { id: 'a1', name: 'A-acc', platform: 'twitch', ownerId: 'u1', createdAt: ts, updatedAt: ts },
      {
        id: 'a2',
        name: 'B-acc',
        platform: 'telegram',
        ownerId: 'u2',
        createdAt: ts,
        updatedAt: ts,
      },
    ]);
    await holder.db.seed('bot', [
      {
        id: 'b1',
        name: 'A-bot',
        platform: 'twitch',
        accountId: 'a1',
        status: 'running',
        config: {},
        ownerId: 'u1',
      },
      {
        id: 'b2',
        name: 'B-bot',
        platform: 'telegram',
        accountId: 'a2',
        status: 'idle',
        config: {},
        ownerId: 'u2',
      },
    ]);

    const listA = await app.inject({ method: 'GET', url: '/api/bots', ...bearer('u1') });
    expect(listA.statusCode).toBe(200);
    expect(listA.json().data.map((b: { name: string }) => b.name)).toEqual(['A-bot']);

    const listB = await app.inject({ method: 'GET', url: '/api/bots', ...bearer('u2') });
    expect(listB.statusCode).toBe(200);
    expect(listB.json().data.map((b: { name: string }) => b.name)).toEqual(['B-bot']);

    const getForeign = await app.inject({ method: 'GET', url: '/api/bots/b1', ...bearer('u2') });
    expect(getForeign.statusCode).toBe(404);

    const patchForeign = await app.inject({
      method: 'PATCH',
      url: '/api/bots/b1',
      payload: { name: 'stolen' },
      ...bearer('u2'),
    });
    expect(patchForeign.statusCode).toBe(404);

    const delForeign = await app.inject({ method: 'DELETE', url: '/api/bots/b1', ...bearer('u2') });
    expect(delForeign.statusCode).toBe(404);

    const still = await app.inject({ method: 'GET', url: '/api/bots/b1', ...bearer('u1') });
    expect(still.statusCode).toBe(200);
    expect(still.json().data.name).toBe('A-bot');
  });

  it('scopes webhooks, scripts and logs to their owner', async () => {
    await holder.db.seed('account', [
      { id: 'a1', name: 'A-acc', platform: 'twitch', ownerId: 'u1', createdAt: ts, updatedAt: ts },
      {
        id: 'a2',
        name: 'B-acc',
        platform: 'telegram',
        ownerId: 'u2',
        createdAt: ts,
        updatedAt: ts,
      },
    ]);
    await holder.db.seed('bot', [
      {
        id: 'b1',
        name: 'A-bot',
        platform: 'twitch',
        accountId: 'a1',
        status: 'running',
        config: {},
        ownerId: 'u1',
      },
      {
        id: 'b2',
        name: 'B-bot',
        platform: 'telegram',
        accountId: 'a2',
        status: 'idle',
        config: {},
        ownerId: 'u2',
      },
    ]);
    await holder.db.seed('webhook', [
      {
        id: 'w1',
        name: 'A-wh',
        url: 'http://localhost:1/h',
        events: [],
        botId: 'b1',
        ownerId: 'u1',
      },
      {
        id: 'w2',
        name: 'B-wh',
        url: 'http://localhost:1/h2',
        events: [],
        botId: 'b2',
        ownerId: 'u2',
      },
    ]);
    await holder.db.seed('script', [
      { id: 's1', name: 'A-sc', botId: 'b1', trigger: 'follow', config: {} },
      { id: 's2', name: 'B-sc', botId: 'b2', trigger: 'follow', config: {} },
    ]);
    await holder.db.seed('log', [
      { id: 'l1', botId: 'b1', level: 'info', message: 'A log', createdAt: ts },
      { id: 'l2', botId: 'b2', level: 'error', message: 'B log', createdAt: ts },
    ]);

    const webhooksA = await app.inject({ method: 'GET', url: '/api/webhooks', ...bearer('u1') });
    expect(webhooksA.json().data.map((w: { name: string }) => w.name)).toEqual(['A-wh']);
    const scriptsA = await app.inject({ method: 'GET', url: '/api/scripts', ...bearer('u1') });
    expect(scriptsA.json().data.map((s: { name: string }) => s.name)).toEqual(['A-sc']);
    const logsA = await app.inject({ method: 'GET', url: '/api/logs', ...bearer('u1') });
    const logsAData = logsA.json().data.logs as Array<{ message: string }>;
    expect(logsAData.map((l) => l.message)).toContain('A log');
    expect(logsAData.map((l) => l.message)).not.toContain('B log');

    const logsB = await app.inject({ method: 'GET', url: '/api/logs', ...bearer('u2') });
    const logsBData = logsB.json().data.logs as Array<{ message: string }>;
    expect(logsBData.map((l) => l.message)).toContain('B log');
    expect(logsBData.map((l) => l.message)).not.toContain('A log');

    const foreignWh = await app.inject({ method: 'GET', url: '/api/webhooks/w1', ...bearer('u2') });
    expect(foreignWh.statusCode).toBe(404);
    const foreignScript = await app.inject({
      method: 'PATCH',
      url: '/api/scripts/s1',
      payload: { name: 'x' },
      ...bearer('u2'),
    });
    expect(foreignScript.statusCode).toBe(404);
  });

  it('scopes per-bot log reads to the caller', async () => {
    await holder.db.seed('account', [
      { id: 'a1', name: 'A-acc', platform: 'twitch', ownerId: 'u1', createdAt: ts, updatedAt: ts },
      {
        id: 'a2',
        name: 'B-acc',
        platform: 'telegram',
        ownerId: 'u2',
        createdAt: ts,
        updatedAt: ts,
      },
    ]);
    await holder.db.seed('bot', [
      {
        id: 'b1',
        name: 'A-bot',
        platform: 'twitch',
        accountId: 'a1',
        status: 'running',
        config: {},
        ownerId: 'u1',
      },
      {
        id: 'b2',
        name: 'B-bot',
        platform: 'telegram',
        accountId: 'a2',
        status: 'idle',
        config: {},
        ownerId: 'u2',
      },
    ]);
    await holder.db.seed('log', [
      { id: 'l1', botId: 'b1', level: 'info', message: 'A secret log', createdAt: ts },
    ]);

    const foreign = await app.inject({ method: 'GET', url: '/api/logs/b1', ...bearer('u2') });
    // Per-bot log reads match on (botId + owner); a foreign bot simply yields
    // no rows (200 with an empty list) rather than leaking existence.
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().data).toEqual([]);

    const own = await app.inject({ method: 'GET', url: '/api/logs/b1', ...bearer('u1') });
    expect(own.statusCode).toBe(200);
    expect(own.json().data.map((l: { message: string }) => l.message)).toContain('A secret log');
  });

  it('reports stats computed only from the callers resources', async () => {
    await holder.db.seed('account', [
      { id: 'a1', name: 'A-acc', platform: 'twitch', ownerId: 'u1', createdAt: ts, updatedAt: ts },
      {
        id: 'a2',
        name: 'B-acc',
        platform: 'telegram',
        ownerId: 'u2',
        createdAt: ts,
        updatedAt: ts,
      },
      { id: 'a3', name: 'B-acc2', platform: 'crypto', ownerId: 'u2', createdAt: ts, updatedAt: ts },
    ]);
    await holder.db.seed('bot', [
      {
        id: 'b1',
        name: 'A-bot',
        platform: 'twitch',
        accountId: 'a1',
        status: 'running',
        config: {},
        ownerId: 'u1',
      },
      {
        id: 'b2',
        name: 'B-bot',
        platform: 'telegram',
        accountId: 'a2',
        status: 'idle',
        config: {},
        ownerId: 'u2',
      },
      {
        id: 'b3',
        name: 'B-bot2',
        platform: 'crypto',
        accountId: 'a3',
        status: 'running',
        config: {},
        ownerId: 'u2',
      },
    ]);

    const statsA = await app.inject({ method: 'GET', url: '/api/stats', ...bearer('u1') });
    const resA = statsA.json().data;
    expect(resA.totalBots).toBe(1);
    expect(resA.activeBots).toBe(1);
    expect(resA.totalAccounts).toBe(1);

    const statsB = await app.inject({ method: 'GET', url: '/api/stats', ...bearer('u2') });
    const resB = statsB.json().data;
    expect(resB.totalBots).toBe(2);
    expect(resB.activeBots).toBe(1);
    expect(resB.totalAccounts).toBe(2);
  });

  it('exports backup with only the callers resources', async () => {
    await holder.db.seed('account', [
      {
        id: 'a1',
        name: 'A-acc',
        platform: 'twitch',
        token: 'a-tok',
        ownerId: 'u1',
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: 'a2',
        name: 'B-acc',
        platform: 'telegram',
        token: 'b-tok',
        ownerId: 'u2',
        createdAt: ts,
        updatedAt: ts,
      },
    ]);
    await holder.db.seed('bot', [
      {
        id: 'b1',
        name: 'A-bot',
        platform: 'twitch',
        accountId: 'a1',
        status: 'running',
        config: {},
        ownerId: 'u1',
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: 'b2',
        name: 'B-bot',
        platform: 'telegram',
        accountId: 'a2',
        status: 'idle',
        config: {},
        ownerId: 'u2',
        createdAt: ts,
        updatedAt: ts,
      },
    ]);

    const expA = await app.inject({
      method: 'GET',
      url: '/api/backup/export?includeCredentials=true',
      ...bearer('u1'),
    });
    expect(expA.statusCode).toBe(200);
    const dataA = expA.json().data;
    expect(dataA.accounts.length).toBe(1);
    expect(dataA.accounts[0].token).toBe('a-tok');
    expect(dataA.bots.length).toBe(1);
    expect(dataA.bots[0].name).toBe('A-bot');

    const expB = await app.inject({
      method: 'GET',
      url: '/api/backup/export?includeCredentials=true',
      ...bearer('u2'),
    });
    const dataB = expB.json().data;
    expect(dataB.accounts.length).toBe(1);
    expect(dataB.accounts[0].token).toBe('b-tok');
    expect(dataB.bots.length).toBe(1);
    expect(dataB.bots[0].name).toBe('B-bot');
  });
});
