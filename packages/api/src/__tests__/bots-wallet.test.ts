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

const signToken = (id: string) => app.jwt.sign({ id, email: 'admin@bothive.test', role: 'admin' });

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
  await holder.db.seed('account', [{ id: 'a1', name: 'Binance', platform: 'crypto', token: 'x' }]);

const authed = async () => {
  await seedUser();
  return { headers: { authorization: `Bearer ${signToken('u1')}` } };
};

const createCryptoBot = async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bots',
    ...(await authed()),
    payload: {
      name: 'Trader',
      platform: 'crypto',
      accountId: 'a1',
      config: { crypto: { symbols: ['BTCUSDT'], strategy: 'alert' } },
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data as { id: string; config: Record<string, unknown> };
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

describe('bot wallet privacy', () => {
  it('never serializes the wallet private key on GET', async () => {
    await seedAccount();
    const bot = await createCryptoBot();

    // The stored config DOES have an encrypted private key (create route).
    const stored = (bot.config.crypto as Record<string, unknown>).wallet as Record<string, unknown>;
    expect(typeof stored.privateKey).toBe('string');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/bots/${bot.id}`,
      ...(await authed()),
    });
    const wallet = (detail.json().data.config.crypto as Record<string, unknown>).wallet as Record<
      string,
      unknown
    >;
    expect(typeof wallet.address).toBe('string');
    expect(wallet.privateKey).toBeUndefined();
  });

  it('encrypts a user-provided wallet private key on create', async () => {
    await seedAccount();
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots',
      ...(await authed()),
      payload: {
        name: 'Imported',
        platform: 'crypto',
        accountId: 'a1',
        config: {
          crypto: {
            symbols: ['BTCUSDT'],
            wallet: { address: `0x${'c'.repeat(40)}`, privateKey: 'raw-private-key-123' },
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);

    const dbBot = await (
      holder.db.prisma.bot as unknown as {
        findUnique: (args: { where: { id: string } }) => Promise<{
          config: Record<string, unknown>;
        } | null>;
      }
    ).findUnique({ where: { id: res.json().data.id } });
    const storedKey = (
      (dbBot?.config.crypto as Record<string, unknown>).wallet as Record<string, unknown>
    ).privateKey;
    expect(storedKey).toMatch(/^enc:/);
    expect(storedKey).not.toContain('raw-private-key-123');
  });

  it('encrypts a new private key sent via PATCH', async () => {
    await seedAccount();
    const bot = await createCryptoBot();

    const masked = { ...bot.config };
    const maskedCrypto = {
      ...(masked.crypto as Record<string, unknown>),
      wallet: { address: `0x${'d'.repeat(40)}` },
    };
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/bots/${bot.id}`,
      ...(await authed()),
      payload: {
        config: {
          ...masked,
          crypto: {
            ...maskedCrypto,
            wallet: { ...(maskedCrypto.wallet as object), privateKey: 'fresh-raw-key' },
          },
        },
      },
    });
    expect(patched.statusCode).toBe(200);

    const dbBot = await (
      holder.db.prisma.bot as unknown as {
        findUnique: (args: { where: { id: string } }) => Promise<{
          config: Record<string, unknown>;
        } | null>;
      }
    ).findUnique({ where: { id: bot.id } });
    const storedKey = (
      (dbBot?.config.crypto as Record<string, unknown>).wallet as Record<string, unknown>
    ).privateKey;
    expect(storedKey).toMatch(/^enc:/);
    expect(storedKey).not.toContain('fresh-raw-key');
  });

  it('preserves the private key when a masked config is saved back', async () => {
    await seedAccount();
    const bot = await createCryptoBot();

    // Save the exact masked config the dashboard would send back (no key).
    const masked = { ...bot.config };
    delete (masked.crypto as Record<string, unknown> & { wallet?: Record<string, unknown> }).wallet
      ?.privateKey;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/bots/${bot.id}`,
      ...(await authed()),
      payload: { name: 'Trader v2', config: masked },
    });
    expect(patched.statusCode).toBe(200);

    // The stored key survived (read straight from the DB, not the API).
    const dbBot = await (
      holder.db.prisma.bot as unknown as {
        findUnique: (args: { where: { id: string } }) => Promise<{
          config: Record<string, unknown>;
        } | null>;
      }
    ).findUnique({ where: { id: bot.id } });
    const dbWallet = ((dbBot?.config as Record<string, unknown>).crypto as Record<string, unknown>)
      .wallet as Record<string, unknown>;
    expect(typeof dbWallet.privateKey).toBe('string');

    // And the API still masks it.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/bots/${bot.id}`,
      ...(await authed()),
    });
    const wallet = (detail.json().data.config.crypto as Record<string, unknown>).wallet as Record<
      string,
      unknown
    >;
    expect(wallet.privateKey).toBeUndefined();
    expect(detail.json().data.name).toBe('Trader v2');
  });
});

describe('bot config keys survive validation', () => {
  it('keeps aiEnabled / aiModel / aiSystemPrompt and channel routing keys', async () => {
    await seedAccount();
    await holder.db.seed('account', [{ id: 'a2', name: 'Twitch', platform: 'twitch', token: 'x' }]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots',
      ...(await authed()),
      payload: {
        name: 'AI Bot',
        platform: 'twitch',
        accountId: 'a2',
        config: {
          aiEnabled: true,
          aiModel: 'qwen2.5:7b',
          aiSystemPrompt: 'Be brief',
          channelId: '123456',
          channel: 'mychannel',
          username: 'botuser',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.config).toMatchObject({
      aiEnabled: true,
      aiModel: 'qwen2.5:7b',
      aiSystemPrompt: 'Be brief',
      channelId: '123456',
      channel: 'mychannel',
      username: 'botuser',
    });
  });

  it('preserves unknown config keys on update', async () => {
    await seedAccount();
    await holder.db.seed('account', [{ id: 'a2', name: 'Twitch', platform: 'twitch', token: 'x' }]);
    const created = await app.inject({
      method: 'POST',
      url: '/api/bots',
      ...(await authed()),
      payload: {
        name: 'K',
        platform: 'twitch',
        accountId: 'a2',
        config: { customFutureKey: { nested: 1 } },
      },
    });
    expect(created.statusCode).toBe(200);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/bots/${created.json().data.id}`,
      ...(await authed()),
      payload: { config: { ...created.json().data.config, rateLimitPerMinute: 4 } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.config).toMatchObject({
      customFutureKey: { nested: 1 },
      rateLimitPerMinute: 4,
    });
  });
});
