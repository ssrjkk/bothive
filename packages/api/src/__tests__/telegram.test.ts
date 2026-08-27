import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { encryptCredential, telegramWebhookSlug } from '@bothive/core';
import { enqueueTelegramUpdate } from '../services/queue.js';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { MockDb } from './helpers/mock-db.js';

const holder = vi.hoisted(() => ({ db: null as unknown as MockDb }));

vi.mock('../services/prisma.js', async () => {
  const { createMockDb } = await import('./helpers/mock-db.js');
  const db = createMockDb();
  holder.db = db;
  return { prisma: db.prisma };
});

vi.mock('../services/queue.js', () => ({
  enqueueTelegramUpdate: vi.fn(async () => ({ id: 'job' })),
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

vi.mock('@bothive/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bothive/core')>();
  return { ...mod, testProxy: vi.fn(async () => true) };
});

const TOKEN = '123:real-bot-token';
// The webhook URL path carries the derived slug, never the raw token.
const SLUG = telegramWebhookSlug('tg-bot', TOKEN);

let app: FastifyInstance;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-0123456789abcdef';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  app = await buildApp();
});

beforeEach(() => {
  holder.db.reset();
  vi.clearAllMocks();
});

afterAll(async () => {
  await app.close();
});

function seedTelegramBot() {
  holder.db.seed('account', [
    {
      id: 'tg-acc',
      name: 'TG Acc',
      platform: 'telegram',
      token: encryptCredential(TOKEN),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);
  holder.db.seed('bot', [
    {
      id: 'tg-bot',
      name: 'TG Bot',
      platform: 'telegram',
      accountId: 'tg-acc',
      status: 'running',
      config: {},
    },
  ]);
}

const postUpdate = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: body, headers });

describe('POST /api/telegram/webhook/:botId/:token', () => {
  it('rejects an unknown bot with 404', async () => {
    const res = await postUpdate('/api/telegram/webhook/ghost/some-token', { update_id: 1 });
    expect(res.statusCode).toBe(404);
    expect(enqueueTelegramUpdate).not.toHaveBeenCalled();
  });

  it('rejects a wrong bot token (header) with 404', async () => {
    seedTelegramBot();
    const res = await postUpdate(
      `/api/telegram/webhook/tg-bot/${SLUG}`,
      { update_id: 1 },
      { 'x-telegram-bot-api-secret-token': 'wrong-token' },
    );
    expect(res.statusCode).toBe(404);
    expect(enqueueTelegramUpdate).not.toHaveBeenCalled();
  });

  it('rejects a wrong path slug with 404 even when the header is correct', async () => {
    seedTelegramBot();
    const res = await postUpdate(
      `/api/telegram/webhook/tg-bot/not-the-slug`,
      { update_id: 1 },
      { 'x-telegram-bot-api-secret-token': TOKEN },
    );
    expect(res.statusCode).toBe(404);
    expect(enqueueTelegramUpdate).not.toHaveBeenCalled();
  });

  it('rejects a non-telegram bot with 404', async () => {
    holder.db.seed('account', [
      {
        id: 'tw-acc',
        name: 'TW Acc',
        platform: 'twitch',
        token: TOKEN,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    holder.db.seed('bot', [
      {
        id: 'tw-bot',
        name: 'TW Bot',
        platform: 'twitch',
        accountId: 'tw-acc',
        status: 'running',
        config: {},
      },
    ]);
    const res = await postUpdate(`/api/telegram/webhook/tw-bot/${SLUG}`, { update_id: 1 });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a missing secret-token header with 404', async () => {
    seedTelegramBot();
    const res = await postUpdate(`/api/telegram/webhook/tg-bot/${SLUG}`, { update_id: 1 });
    expect(res.statusCode).toBe(404);
    expect(enqueueTelegramUpdate).not.toHaveBeenCalled();
  });

  it('rejects a mismatched secret-token header with 404', async () => {
    seedTelegramBot();
    const res = await postUpdate(
      `/api/telegram/webhook/tg-bot/${SLUG}`,
      { update_id: 1 },
      { 'x-telegram-bot-api-secret-token': 'different' },
    );
    expect(res.statusCode).toBe(404);
    expect(enqueueTelegramUpdate).not.toHaveBeenCalled();
  });

  it('rejects a payload without a numeric update_id with 400', async () => {
    seedTelegramBot();
    const headers = { 'x-telegram-bot-api-secret-token': TOKEN };
    for (const body of [{}, [], { update_id: '7' }, null]) {
      const res = await postUpdate(`/api/telegram/webhook/tg-bot/${SLUG}`, body, headers);
      expect(res.statusCode).toBe(400);
    }
    expect(enqueueTelegramUpdate).not.toHaveBeenCalled();
  });

  it('enqueues a valid update and answers ok', async () => {
    seedTelegramBot();
    const update = {
      update_id: 123,
      message: { message_id: 1, text: 'hi', chat: { id: 42 } },
    };
    const res = await postUpdate(`/api/telegram/webhook/tg-bot/${SLUG}`, update, {
      'x-telegram-bot-api-secret-token': TOKEN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(enqueueTelegramUpdate).toHaveBeenCalledWith('tg-bot', update);
  });

  it('answers 502 when the update cannot be enqueued', async () => {
    seedTelegramBot();
    vi.mocked(enqueueTelegramUpdate).mockRejectedValueOnce(new Error('redis down'));

    const res = await postUpdate(
      `/api/telegram/webhook/tg-bot/${SLUG}`,
      { update_id: 5 },
      { 'x-telegram-bot-api-secret-token': TOKEN },
    );
    expect(res.statusCode).toBe(502);
  });

  it('does not require authentication', async () => {
    seedTelegramBot();
    const res = await postUpdate(
      `/api/telegram/webhook/tg-bot/${SLUG}`,
      { update_id: 9 },
      { 'x-telegram-bot-api-secret-token': TOKEN },
    );
    expect(res.statusCode).toBe(200);
  });
});
