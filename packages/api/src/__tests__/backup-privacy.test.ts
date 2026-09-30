import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db.js';
import type { MockDb } from './helpers/mock-db.js';

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

const seedViewer = async () =>
  await holder.db.seed('user', [
    { id: 'v1', email: 'viewer@bothive.test', name: 'Viewer', role: 'viewer', passwordHash: 'x' },
  ]);

const authed = async () => {
  await seedUser();
  return { headers: { authorization: `Bearer ${signToken('u1')}` } };
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

describe('backup privacy & RBAC', () => {
  it('masks the crypto wallet private key in the default export', async () => {
    await holder.db.seed('account', [
      { id: 'a1', name: 'Binance', platform: 'crypto', token: 'x' },
    ]);
    await holder.db.seed('bot', [
      {
        id: 'b1',
        name: 'Trader',
        platform: 'crypto',
        accountId: 'a1',
        status: 'idle',
        config: {
          crypto: {
            symbols: ['BTCUSDT'],
            wallet: { address: `0x${'a'.repeat(40)}`, privateKey: 'enc:secret-key' },
          },
        },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/backup/export',
      ...(await authed()),
    });
    expect(res.statusCode).toBe(200);
    const botConfig = res.json().data.bots[0].config as Record<string, unknown>;
    const wallet = (botConfig.crypto as Record<string, unknown>).wallet as Record<string, unknown>;
    expect(wallet.address).toBe(`0x${'a'.repeat(40)}`);
    expect(wallet.privateKey).toBeUndefined();
  });

  it('includes the wallet private key only with the explicit opt-in', async () => {
    await holder.db.seed('account', [
      { id: 'a1', name: 'Binance', platform: 'crypto', token: 'x' },
    ]);
    await holder.db.seed('bot', [
      {
        id: 'b1',
        name: 'Trader',
        platform: 'crypto',
        accountId: 'a1',
        status: 'idle',
        config: {
          crypto: {
            symbols: ['BTCUSDT'],
            wallet: { address: `0x${'a'.repeat(40)}`, privateKey: 'enc:secret-key' },
          },
        },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/backup/export?includeCredentials=true',
      ...(await authed()),
    });
    const wallet = (
      (res.json().data.bots[0].config as Record<string, unknown>).crypto as Record<string, unknown>
    ).wallet as Record<string, unknown>;
    expect(wallet.privateKey).toBe('enc:secret-key');
  });

  it('import is admin-only (viewers get 403)', async () => {
    await seedViewer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: { authorization: `Bearer ${signToken('v1', 'viewer@bothive.test')}` },
      payload: { version: 1, app: 'bothive', accounts: [], bots: [], scripts: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});
