import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Queue } from 'bullmq';
import { createTestDb } from './helpers/test-db.js';
import type { MockDb } from './helpers/mock-db.js';
import { redisConnectionOptions } from '@bothive/core';

const holder = vi.hoisted(() => ({ db: null as unknown as MockDb }));
holder.db = (await createTestDb()) as unknown as MockDb;

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { hashPassword } from '../utils/password.js';

const seededHash = await hashPassword('password123');

let app: FastifyInstance;

const signToken = (id: string, email = 'admin@bothive.test') =>
  app.jwt.sign({ id, email, role: 'admin' });

const seedUser = async () =>
  await holder.db.seed('user', [
    {
      id: 'u1',
      email: 'admin@bothive.test',
      name: 'Admin',
      role: 'admin',
      passwordHash: seededHash,
    },
  ]);

const seedAccount = async () =>
  await holder.db.seed('account', [{ id: 'a1', name: 'Acc', platform: 'twitch', token: 'x' }]);

const seedBot = async (id = 'b1', platform = 'twitch') =>
  await holder.db.seed('bot', [
    { id, name: `Bot ${id}`, platform, accountId: 'a1', status: 'running', config: {} },
  ]);

const seedEvent = async (
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; eventId: string }> => {
  const eventId = `evt-${Math.random().toString(36).slice(2, 10)}`;
  const row = {
    id: 'e1',
    botId: 'b1',
    platform: 'twitch',
    type: 'follow',
    version: 1,
    eventId,
    payload: { username: 'alice' },
    ...overrides,
  };
  await holder.db.seed('eventRecord', [row]);
  return { id: row.id as string, eventId: row.eventId as string };
};

const authed = async (headers: Record<string, string> = {}) => {
  await seedUser();
  return { headers: { authorization: `Bearer ${signToken('u1')}`, ...headers } };
};

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-0123456789abcdef';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  app = await buildApp();
});

beforeEach(async () => {
  await holder.db.reset();
  vi.clearAllMocks();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('event store routes', () => {
  it('lists stored events scoped to the owner', async () => {
    await seedAccount();
    await seedBot();
    await seedEvent({ eventId: 'evt-list-1' });

    const res = await app.inject({ method: 'GET', url: '/api/events', ...(await authed()) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0]).toMatchObject({
      botId: 'b1',
      platform: 'twitch',
      type: 'follow',
      version: 1,
    });
    expect(res.json().total).toBe(1);
  });

  it('filters events by platform and type', async () => {
    await seedAccount();
    await seedBot();
    await seedEvent({ eventId: 'evt-a', platform: 'twitch', type: 'follow' });
    await holder.db.seed('eventRecord', [
      {
        id: 'e2',
        botId: 'b1',
        platform: 'telegram',
        type: 'message',
        version: 1,
        eventId: 'evt-b',
        payload: { text: 'hi' },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/events?platform=telegram&type=message',
      ...(await authed()),
    });
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].eventId).toBe('evt-b');
  });

  it('reports store analytics scoped to the owner', async () => {
    await seedAccount();
    await seedBot();
    await holder.db.seed('eventRecord', [
      {
        id: 'e1',
        botId: 'b1',
        platform: 'twitch',
        type: 'follow',
        version: 1,
        eventId: 'evt-s1',
        payload: {},
        replayCount: 2,
      },
      {
        id: 'e2',
        botId: 'b1',
        platform: 'twitch',
        type: 'message',
        version: 1,
        eventId: 'evt-s2',
        payload: {},
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/stats',
      ...(await authed()),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.total).toBe(2);
    expect(res.json().data.replayed).toBe(1);
    expect(res.json().data.byType).toEqual(
      expect.arrayContaining([
        { type: 'follow', count: 1 },
        { type: 'message', count: 1 },
      ]),
    );
    expect(res.json().data.byPlatform).toEqual([{ platform: 'twitch', count: 2 }]);
  });

  it('hides events of other tenants', async () => {
    await seedAccount();
    await seedBot();
    // A second owner with a bot whose events must not leak.
    await holder.db.seed('user', [
      { id: 'u2', email: 'other@bothive.test', name: 'Other', role: 'viewer', passwordHash: 'x' },
    ]);
    await holder.db.seed('account', [
      { id: 'a2', name: 'A', platform: 'twitch', token: 'x', ownerId: 'u2' },
    ]);
    await holder.db.seed('bot', [
      {
        id: 'b2',
        name: 'B',
        platform: 'twitch',
        accountId: 'a2',
        status: 'idle',
        config: {},
        ownerId: 'u2',
      },
    ]);
    // Both events in one seed call: the helper replaces all rows of a model.
    await holder.db.seed('eventRecord', [
      {
        id: 'e1',
        botId: 'b1',
        platform: 'twitch',
        type: 'follow',
        version: 1,
        eventId: 'evt-other',
        payload: {},
      },
      {
        id: 'e3',
        botId: 'b2',
        platform: 'twitch',
        type: 'message',
        version: 1,
        eventId: 'evt-leak',
        payload: {},
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/events', ...(await authed()) });
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].eventId).toBe('evt-other');
  });

  it('gets a single stored event', async () => {
    await seedAccount();
    await seedBot();
    await seedEvent({ eventId: 'evt-single' });

    const res = await app.inject({ method: 'GET', url: '/api/events/e1', ...(await authed()) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.eventId).toBe('evt-single');
  });

  it('404s for a missing event', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events/nope', ...(await authed()) });
    expect(res.statusCode).toBe(404);
  });

  it('replays an event: enqueues the job and increments replayCount', async () => {
    await seedAccount();
    await seedBot();
    await seedEvent({ eventId: 'evt-replay' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/events/e1/replay',
      ...(await authed()),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toContain('replay');

    const stored = await app.inject({ method: 'GET', url: '/api/events/e1', ...(await authed()) });
    expect(stored.json().data.replayCount).toBe(1);
    expect(stored.json().data.lastReplayedAt).toBeTruthy();
  });

  it('rejects replay of an unsupported contract version', async () => {
    await seedAccount();
    await seedBot();
    await seedEvent({ eventId: 'evt-old', version: 99 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/events/e1/replay',
      ...(await authed()),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('UNSUPPORTED_CONTRACT');
  });

  it('replay is admin-only', async () => {
    await seedAccount();
    await seedBot();
    await seedEvent({ eventId: 'evt-viewer' });
    await holder.db.seed('user', [
      { id: 'u3', email: 'viewer@bothive.test', name: 'Viewer', role: 'viewer', passwordHash: 'x' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/events/e1/replay',
      headers: { authorization: `Bearer ${signToken('u3')}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deletes a stored event (admin)', async () => {
    await seedAccount();
    await seedBot();
    await seedEvent({ eventId: 'evt-delete' });

    const del = await app.inject({ method: 'DELETE', url: '/api/events/e1', ...(await authed()) });
    expect(del.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: '/api/events/e1', ...(await authed()) });
    expect(res.statusCode).toBe(404);
  });
});

describe('dead-letter queue routes', () => {
  it('lists dead-letter jobs across platforms', async () => {
    const dlq = new Queue('twitch-queue-dlq', {
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        ...redisConnectionOptions(),
      },
    });
    await dlq.add(
      'dlq',
      {
        originalQueue: 'twitch-queue',
        jobId: 'j1',
        name: 'connect',
        type: 'connect',
        botId: 'b1',
        payload: { botId: 'b1' },
        failedReason: 'boom',
        attemptsMade: 3,
        timestamp: Date.now(),
      },
      { jobId: 'dlq-test-job' },
    );

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/queues/dead-letter',
        ...(await authed()),
      });
      expect(res.statusCode).toBe(200);
      const found = res.json().data.find((j: { id: string }) => j.id === 'dlq-test-job');
      expect(found).toMatchObject({ platform: 'twitch', type: 'connect', botId: 'b1' });
      expect(found.failedReason).toBe('boom');
    } finally {
      await dlq.close();
    }
  });

  it('replays a dead-letter job onto its original queue', async () => {
    const dlq = new Queue('twitch-queue-dlq', {
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        ...redisConnectionOptions(),
      },
    });
    await dlq.add(
      'connect',
      {
        originalQueue: 'twitch-queue',
        jobId: 'j2',
        name: 'connect',
        type: 'connect',
        botId: 'b1',
        payload: {},
        failedReason: 'boom',
        attemptsMade: 1,
        timestamp: Date.now(),
      },
      { jobId: 'dlq-replay-job' },
    );

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/queues/dead-letter/twitch/dlq-replay-job/replay',
        ...(await authed()),
      });
      expect(res.statusCode).toBe(200);
      const after = await dlq.getJob('dlq-replay-job');
      expect(after).toBeUndefined();
    } finally {
      await dlq.close();
    }
  });

  it('404s replaying a job that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/queues/dead-letter/twitch/ghost/replay',
      ...(await authed()),
    });
    expect(res.statusCode).toBe(404);
  });

  it('prunes dead-letter jobs older than the retention cutoff', async () => {
    const dlq = new Queue('twitch-queue-dlq', {
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        ...redisConnectionOptions(),
      },
    });
    const now = Date.now();
    await dlq.add(
      'dlq',
      { originalQueue: 'twitch-queue', jobId: 'old', type: 'connect', botId: 'b1', payload: {} },
      { jobId: 'dlq-old-job', timestamp: now - 40 * 24 * 3600 * 1000 },
    );
    await dlq.add(
      'dlq',
      { originalQueue: 'twitch-queue', jobId: 'fresh', type: 'connect', botId: 'b1', payload: {} },
      { jobId: 'dlq-fresh-job', timestamp: now },
    );

    try {
      const { pruneDeadLetterJobs } = await import('../services/queue.js');
      const cutoff = new Date(now - 30 * 24 * 3600 * 1000);
      const removed = await pruneDeadLetterJobs(cutoff);
      expect(removed).toBeGreaterThanOrEqual(1);

      expect(await dlq.getJob('dlq-old-job')).toBeUndefined();
      expect(await dlq.getJob('dlq-fresh-job')).toBeDefined();
    } finally {
      await dlq.close();
    }
  });

  it('dead-letter endpoints are admin-only', async () => {
    await holder.db.seed('user', [
      { id: 'u4', email: 'viewer2@bothive.test', name: 'V', role: 'viewer', passwordHash: 'x' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/queues/dead-letter',
      headers: { authorization: `Bearer ${signToken('u4')}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
