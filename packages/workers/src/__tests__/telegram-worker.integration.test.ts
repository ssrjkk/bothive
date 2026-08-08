import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramWorker } from '../telegram/worker.js';

interface FakeApi {
  config: { use: ReturnType<typeof vi.fn> };
  sendMessage: ReturnType<typeof vi.fn>;
  sendPhoto: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
  sendSticker: ReturnType<typeof vi.fn>;
  sendDice: ReturnType<typeof vi.fn>;
  setMessageReaction: ReturnType<typeof vi.fn>;
}

interface FakeBotInstance {
  token: string;
  handlers: Map<string, (ctx: unknown) => unknown>;
  api: FakeApi;
  started: unknown;
  stopped: boolean;
}

// Shared state so tests can reach the FakeBot instances created by connect().
const botMock = vi.hoisted(() => {
  const instances: FakeBotInstance[] = [];
  return { instances };
});

vi.mock('grammy', () => {
  class FakeBot {
    api: FakeApi;
    handlers = new Map<string, (ctx: unknown) => unknown>();
    started: unknown = null;
    stopped = false;
    constructor(public token: string) {
      this.api = {
        config: { use: vi.fn() },
        sendMessage: vi.fn(),
        sendPhoto: vi.fn(),
        deleteMessage: vi.fn(),
        sendSticker: vi.fn(),
        sendDice: vi.fn(),
        setMessageReaction: vi.fn(),
      };
      botMock.instances.push(this);
    }
    on(event: string, handler: (ctx: unknown) => unknown) {
      this.handlers.set(event, handler);
      return this;
    }
    async start(opts: unknown) {
      this.started = opts;
    }
    async stop() {
      this.stopped = true;
    }
  }
  return { Bot: FakeBot };
});

vi.mock('@grammyjs/auto-retry', () => ({ autoRetry: vi.fn(() => 'retry-middleware') }));

const redisMock = vi.hoisted(() => ({
  state: { leaderKey: 'bothive:leader:telegram', holder: null as string | null },
}));

vi.mock('ioredis', () => {
  class FakeRedis {
    status = 'ready';
    constructor(_url: string, _opts?: unknown) {}
    async connect(): Promise<void> {}
    async set(key: string, value: string, ...rest: unknown[]): Promise<string | null> {
      if (rest.includes('NX') && redisMock.state.holder !== null) return null;
      redisMock.state.holder = value;
      return 'OK';
    }
    async get(key: string): Promise<string | null> {
      return key === redisMock.state.leaderKey ? redisMock.state.holder : null;
    }
    async pexpire(_key: string, _ms: number): Promise<number> {
      return 1;
    }
    async del(_key: string): Promise<number> {
      redisMock.state.holder = null;
      return 1;
    }
    async incr(_key: string): Promise<number> {
      return 1;
    }
    async disconnect(): Promise<void> {}
  }
  return { Redis: FakeRedis };
});

vi.mock('bullmq', () => {
  class FakeWorker {
    opts = { concurrency: 1 };
    async on() {
      return this;
    }
    async waitUntilReady(): Promise<void> {}
    async pause(): Promise<void> {}
    async resume(): Promise<void> {}
    async close(): Promise<void> {}
  }
  class FakeQueue {
    async close(): Promise<void> {}
    async add(): Promise<never> {
      throw new Error('not implemented');
    }
  }
  return { Worker: FakeWorker, Queue: FakeQueue, Job: class {} };
});

vi.mock('../prisma.js', () => ({
  prisma: {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    bot: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    log: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock('../log-publisher.js', () => ({ publishLog: vi.fn() }));
vi.mock('../webhooks.js', () => ({ dispatchWebhooks: vi.fn() }));
vi.mock('@bothive/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bothive/core')>();
  return { ...mod, decryptCredential: vi.fn((value: unknown) => value) };
});

// FakeBot instances are captured in creation order; connect() creates exactly
// one per call, so the last entry is the bot from the most recent connect().
function latestBot(): (typeof botMock.instances)[number] | undefined {
  return botMock.instances[botMock.instances.length - 1];
}

function makeTelegramWorker(): { worker: TelegramWorker; events: unknown[] } {
  const worker = new TelegramWorker('redis://fake:6379');
  const events: unknown[] = [];
  worker.onEvent((event) => events.push(event));
  return { worker, events };
}

describe('TelegramWorker adapter', () => {
  beforeEach(() => {
    botMock.instances.length = 0;
  });

  afterEach(() => {
    botMock.instances.length = 0;
  });

  it('connects, registers handlers and emits a message event', async () => {
    const { worker, events } = makeTelegramWorker();

    await worker.connect({ token: '123:bot-token', botId: 'bot1' });

    const bot = latestBot();
    expect(bot).toBeDefined();
    expect(bot?.token).toBe('123:bot-token');
    expect(bot?.started).toEqual({ drop_pending_updates: true, onStart: expect.any(Function) });

    const handler = bot?.handlers.get('message');
    expect(handler).toBeDefined();
    await handler?.({
      message: { text: 'hello', message_id: 42 },
      from: { id: 1, first_name: 'tester' },
      chat: { id: 123, type: 'private' },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      botId: 'bot1',
      platform: 'telegram',
      type: 'message',
      payload: { text: 'hello', chatId: 123, messageId: 42 },
    });
    expect(worker.isConnected('bot1')).toBe(true);
    expect(worker.getStatus('bot1')).toBe('running');
  });

  it('emits callback query data through the message event', async () => {
    const { worker, events } = makeTelegramWorker();
    await worker.connect({ token: '123:bot-token', botId: 'bot1' });

    const handler = latestBot()?.handlers.get('callback_query:data');
    await handler?.({
      callbackQuery: {
        data: 'btn:save',
        from: { id: 7, first_name: 'clicker' },
        message: { chat: { id: 999 }, message_id: 11 },
      },
    });

    expect(events[0]).toMatchObject({
      type: 'message',
      payload: { callbackData: 'btn:save', chatId: 999, messageId: 11 },
    });
  });

  it('rejects a connect without token or botId', async () => {
    const { worker } = makeTelegramWorker();
    await expect(worker.connect({ token: '', botId: 'bot1' })).rejects.toThrow(/Missing token/i);
    await expect(worker.connect({ token: 't', botId: '' })).rejects.toThrow(/Missing token/i);
  });

  it('stops the previous bot instance when reconnecting the same bot', async () => {
    const { worker } = makeTelegramWorker();
    await worker.connect({ token: '123:a', botId: 'bot1' });
    const first = latestBot();
    await worker.connect({ token: '123:b', botId: 'bot1' });

    expect(first?.stopped).toBe(true);
    expect(latestBot()?.token).toBe('123:b');
  });

  it('executes sendMessage actions against the Telegram API', async () => {
    const { worker } = makeTelegramWorker();
    await worker.connect({ token: '123:bot-token', botId: 'bot1' });

    await worker.executeAction('bot1', {
      type: 'sendMessage',
      payload: { chatId: 555, text: 'hi there', parseMode: 'HTML' },
    });

    const api = latestBot()?.api;
    expect(api?.sendMessage).toHaveBeenCalledWith(555, 'hi there', { parse_mode: 'HTML' });
  });

  it('executes react actions with a default emoji', async () => {
    const { worker } = makeTelegramWorker();
    await worker.connect({ token: '123:bot-token', botId: 'bot1' });

    await worker.executeAction('bot1', { type: 'react', payload: { chatId: 1, messageId: 2 } });
    const api = latestBot()?.api;
    expect(api?.setMessageReaction).toHaveBeenCalledWith(1, 2, [{ type: 'emoji', emoji: '👍' }]);
  });

  it('rejects react without chatId and messageId', async () => {
    const { worker } = makeTelegramWorker();
    await worker.connect({ token: '123:bot-token', botId: 'bot1' });

    await expect(
      worker.executeAction('bot1', { type: 'react', payload: { chatId: 1 } }),
    ).rejects.toThrow(/chatId and messageId/i);
  });

  it('rejects unknown actions and actions on a disconnected bot', async () => {
    const { worker } = makeTelegramWorker();
    await worker.connect({ token: '123:bot-token', botId: 'bot1' });

    await expect(worker.executeAction('bot1', { type: 'nope', payload: {} })).rejects.toThrow(
      /Unknown action/i,
    );
    await expect(
      worker.executeAction('ghost', { type: 'sendMessage', payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });

  it('disconnect stops the bot and clears state', async () => {
    const { worker } = makeTelegramWorker();
    await worker.connect({ token: '123:bot-token', botId: 'bot1' });

    await worker.disconnect('bot1');

    expect(latestBot()?.stopped).toBe(true);
    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
  });
});
