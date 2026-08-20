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
  setWebhook: ReturnType<typeof vi.fn>;
  deleteWebhook: ReturnType<typeof vi.fn>;
}

interface FakeBotInstance {
  token: string;
  handlers: Map<string, (ctx: unknown) => unknown>;
  api: FakeApi;
  started: unknown;
  stopped: boolean;
  startPromise: Promise<void>;
  /** Fires the `onStart` callback — simulates grammy completing setup. */
  finishSetup: () => void;
  /** Rejects `start()` — a setup failure before `onStart`, or a dead loop after. */
  failStart: (err: unknown) => void;
  /** Routes a raw Telegram update through the registered handlers like grammy. */
  handleUpdate: (update: {
    message?: Record<string, unknown>;
    callback_query?: Record<string, unknown>;
    my_chat_member?: Record<string, unknown>;
  }) => Promise<void>;
}

// Shared state so tests can reach the FakeBot instances created by connect().
const botMock = vi.hoisted(() => {
  const instances: FakeBotInstance[] = [];
  /** When true, every setWebhook call fails — simulates a Telegram API error. */
  let failWebhook = false;
  return {
    instances,
    failWebhook: () => failWebhook,
    setFailWebhook: (v: boolean) => (failWebhook = v),
  };
});

vi.mock('grammy', () => {
  class FakeBot {
    api: FakeApi;
    handlers = new Map<string, (ctx: unknown) => unknown>();
    started: unknown = null;
    stopped = false;
    startPromise: Promise<void> = Promise.resolve();
    private onStart: (() => void) | null = null;
    private resolveStart!: () => void;
    private rejectStart!: (err: unknown) => void;
    constructor(public token: string) {
      this.api = {
        config: { use: vi.fn() },
        sendMessage: vi.fn(),
        sendPhoto: vi.fn(),
        deleteMessage: vi.fn(),
        sendSticker: vi.fn(),
        sendDice: vi.fn(),
        setMessageReaction: vi.fn(),
        setWebhook: vi.fn(async () => {
          if (botMock.failWebhook()) throw new Error('400: Bad Request');
        }),
        deleteWebhook: vi.fn(),
      };
      botMock.instances.push(this);
    }
    on(event: string, handler: (ctx: unknown) => unknown) {
      this.handlers.set(event, handler);
      return this;
    }
    // Real grammy `start()` awaits its long-polling loop and only resolves once
    // the bot is stopped (bot.js: `await this.loop(options)`). Keeping that
    // contract here means an accidental `await bot.start()` in production code
    // hangs the connect and fails these tests instead of silently passing.
    async start(opts: { drop_pending_updates?: boolean; onStart?: () => void }) {
      this.started = opts;
      this.onStart = opts?.onStart ?? null;
      this.startPromise = new Promise<void>((resolve, reject) => {
        this.resolveStart = resolve;
        this.rejectStart = reject;
      });
      return this.startPromise;
    }
    finishSetup() {
      this.onStart?.();
    }
    failStart(err: unknown) {
      this.rejectStart(err);
    }
    async handleUpdate(update: {
      message?: Record<string, unknown>;
      callback_query?: Record<string, unknown>;
      my_chat_member?: Record<string, unknown>;
    }) {
      if (update.message) {
        const msg = update.message as {
          text?: string;
          message_id?: number;
          from?: unknown;
          chat?: unknown;
        };
        await this.handlers.get('message')?.({ message: msg, from: msg.from, chat: msg.chat });
      } else if (update.callback_query) {
        await this.handlers.get('callback_query:data')?.({ callbackQuery: update.callback_query });
      } else if (update.my_chat_member) {
        await this.handlers.get('my_chat_member')?.({ myChatMember: update.my_chat_member });
      }
    }
    async stop() {
      this.stopped = true;
      // Webhook-mode bots never ran `start()`, so the resolver is unset.
      this.resolveStart?.();
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

const prismaMocks = vi.hoisted(() => ({
  botUpdate: vi.fn().mockResolvedValue({}),
  botFindMany: vi.fn().mockResolvedValue([]),
  logCreate: vi.fn().mockResolvedValue({}),
  logCreateMany: vi.fn().mockResolvedValue({ count: 0 }),
}));

vi.mock('../prisma.js', () => ({
  prisma: {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    bot: {
      findMany: prismaMocks.botFindMany,
      update: prismaMocks.botUpdate,
    },
    log: { create: prismaMocks.logCreate, createMany: prismaMocks.logCreateMany },
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

const createdWorkers: TelegramWorker[] = [];

function makeTelegramWorker(): { worker: TelegramWorker; events: unknown[] } {
  const worker = new TelegramWorker('redis://fake:6379');
  createdWorkers.push(worker);
  const events: unknown[] = [];
  worker.onEvent((event) => events.push(event));
  return { worker, events };
}

/**
 * Starts a connect and completes grammy's setup phase, as real long polling
 * would. Waits for the new Bot instance to appear: on a reconnect the connect
 * first awaits `oldBot.stop()`, so `latestBot()` is still the old bot until
 * the new one is constructed.
 */
async function connectWith(
  worker: TelegramWorker,
  credentials: Record<string, unknown>,
): Promise<void> {
  const before = botMock.instances.length;
  const connecting = worker.connect(credentials);
  await vi.waitFor(() => expect(botMock.instances.length).toBe(before + 1));
  latestBot()?.finishSetup();
  await connecting;
}

describe('TelegramWorker adapter', () => {
  beforeEach(() => {
    botMock.instances.length = 0;
    botMock.setFailWebhook(false);
    process.env.TELEGRAM_WEBHOOK_BASE_URL = 'https://bot.example.com';
    prismaMocks.botUpdate.mockClear();
  });

  afterEach(async () => {
    botMock.instances.length = 0;
    botMock.setFailWebhook(false);
    delete process.env.TELEGRAM_WEBHOOK_BASE_URL;
    prismaMocks.botUpdate.mockClear();
    // A failed connect or a dead polling loop schedules a reconnect timer.
    // Shut down every worker created in this test so those timers are cleared
    // and cannot fire mid-run and spawn stray FakeBot instances that would
    // break the `latestBot()` lookup of the next test.
    await Promise.all(createdWorkers.splice(0).map((w) => w.shutdown()));
  });

  it('connects, registers handlers and emits a message event', async () => {
    const { worker, events } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });

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

  it('does not mark the bot connected before grammy finishes setup', async () => {
    const { worker } = makeTelegramWorker();
    const connecting = worker.connect({ token: '123:bot-token', botId: 'bot1' });

    // Real `start()` takes time to init + deleteWebhook; until `onStart` fires
    // the bot must not be treated as connected (or the reconcile loop would
    // start duplicate connections).
    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).not.toBe('running');

    latestBot()?.finishSetup();
    await connecting;
    expect(worker.isConnected('bot1')).toBe(true);
  });

  it('emits callback query data through the message event', async () => {
    const { worker, events } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });

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

  it('surfaces a grammy setup failure as a connect error and never marks the bot connected', async () => {
    const { worker } = makeTelegramWorker();
    const connecting = worker.connect({ token: '123:bad', botId: 'bot1' });

    latestBot()?.failStart(new Error('401: Unauthorized'));

    await expect(connecting).rejects.toThrow(/Unauthorized/i);
    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
  });

  it('stops the previous bot instance when reconnecting the same bot', async () => {
    const { worker } = makeTelegramWorker();
    await connectWith(worker, { token: '123:a', botId: 'bot1' });
    const first = latestBot();
    await connectWith(worker, { token: '123:b', botId: 'bot1' });

    expect(first?.stopped).toBe(true);
    expect(latestBot()?.token).toBe('123:b');
  });

  it('executes sendMessage actions against the Telegram API', async () => {
    const { worker } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });

    await worker.executeAction('bot1', {
      type: 'sendMessage',
      payload: { chatId: 555, text: 'hi there', parseMode: 'HTML' },
    });

    const api = latestBot()?.api;
    expect(api?.sendMessage).toHaveBeenCalledWith(555, 'hi there', { parse_mode: 'HTML' });
  });

  it('executes react actions with a default emoji', async () => {
    const { worker } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });

    await worker.executeAction('bot1', { type: 'react', payload: { chatId: 1, messageId: 2 } });
    const api = latestBot()?.api;
    expect(api?.setMessageReaction).toHaveBeenCalledWith(1, 2, [{ type: 'emoji', emoji: '👍' }]);
  });

  it('rejects react without chatId and messageId', async () => {
    const { worker } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });

    await expect(
      worker.executeAction('bot1', { type: 'react', payload: { chatId: 1 } }),
    ).rejects.toThrow(/chatId and messageId/i);
  });

  it('rejects unknown actions and actions on a disconnected bot', async () => {
    const { worker } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });

    await expect(worker.executeAction('bot1', { type: 'nope', payload: {} })).rejects.toThrow(
      /Unknown action/i,
    );
    await expect(
      worker.executeAction('ghost', { type: 'sendMessage', payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });

  it('disconnect stops the bot and clears state', async () => {
    const { worker } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });

    await worker.disconnect('bot1');

    expect(latestBot()?.stopped).toBe(true);
    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
  });

  it('drops the zombie connection and reconnects when a running bot dies (401/409)', async () => {
    const { worker } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });
    expect(worker.isConnected('bot1')).toBe(true);

    // The polling loop dies after the bot was running (grammy rethrows on
    // 401 revoked token / 409 duplicate getUpdates instance).
    latestBot()?.failStart(new Error('409: Conflict: terminated by other getUpdates request'));

    await vi.waitFor(() => expect(worker.isConnected('bot1')).toBe(false));
    expect(worker.getStatus('bot1')).toBe('idle');
    // Reconnect machinery engaged: the bot was marked reconnecting in the DB.
    expect(prismaMocks.botUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'reconnecting' }) }),
    );
  });

  it('webhook mode registers the webhook instead of polling', async () => {
    const { worker } = makeTelegramWorker();
    await connectWith(worker, {
      token: '123:bot-token',
      botId: 'bot1',
      webhookMode: true,
    });

    const bot = latestBot();
    expect(bot?.started).toBeNull();
    expect(bot?.api.setWebhook).toHaveBeenCalledWith(
      'https://bot.example.com/api/telegram/webhook/bot1/123:bot-token',
      { secret_token: '123:bot-token', drop_pending_updates: true },
    );
    expect(worker.isConnected('bot1')).toBe(true);
    expect(worker.getStatus('bot1')).toBe('running');
  });

  it('webhook mode fails fast without TELEGRAM_WEBHOOK_BASE_URL', async () => {
    const { worker } = makeTelegramWorker();
    delete process.env.TELEGRAM_WEBHOOK_BASE_URL;

    await expect(
      worker.connect({ token: '123:bot-token', botId: 'bot1', webhookMode: true }),
    ).rejects.toThrow(/TELEGRAM_WEBHOOK_BASE_URL/);
    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
  });

  it('surfaces a setWebhook failure as a connect error', async () => {
    const { worker } = makeTelegramWorker();
    botMock.setFailWebhook(true);

    await expect(
      worker.connect({ token: '123:bot-token', botId: 'bot1', webhookMode: true }),
    ).rejects.toThrow(/Bad Request/i);
    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
  });

  it('handleUpdate routes a raw update through the message handler', async () => {
    const { worker, events } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });

    await worker.handleUpdate('bot1', {
      update_id: 7,
      message: { message_id: 42, text: 'via webhook', from: { id: 9 }, chat: { id: 123 } },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      botId: 'bot1',
      type: 'message',
      payload: { text: 'via webhook', chatId: 123, messageId: 42 },
    });
  });

  it('handleUpdate routes a raw callback query update', async () => {
    const { worker, events } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });

    await worker.handleUpdate('bot1', {
      update_id: 8,
      callback_query: {
        id: 'cq1',
        data: 'btn:webhook',
        from: { id: 9 },
        message: { message_id: 3, chat: { id: 777 } },
      },
    });

    expect(events[0]).toMatchObject({
      type: 'message',
      payload: { callbackData: 'btn:webhook', chatId: 777, messageId: 3 },
    });
  });

  it('handleUpdate rejects for a bot that is not connected', async () => {
    const { worker } = makeTelegramWorker();
    await expect(worker.handleUpdate('ghost', { update_id: 1 })).rejects.toThrow(/not connected/i);
  });

  it('serializes webhook updates per bot while different bots stay parallel', async () => {
    const { worker } = makeTelegramWorker();
    await connectWith(worker, { token: '123:bot-token', botId: 'bot1' });
    await connectWith(worker, { token: '456:bot-token', botId: 'bot2' });

    // Both bots share one counter; bot1's two updates must never overlap, but
    // bot2's update runs while bot1's first is still blocked. A shared gate
    // avoids racy per-handler resolvers.
    let active = 0;
    let maxActive = 0;
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    for (const bot of botMock.instances) {
      bot.handlers.set('message', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate;
        active -= 1;
      });
    }

    const p1 = worker.handleUpdate('bot1', {
      update_id: 1,
      message: { message_id: 1, text: 'a', from: { id: 9 }, chat: { id: 1 } },
    });
    const p2 = worker.handleUpdate('bot1', {
      update_id: 2,
      message: { message_id: 2, text: 'b', from: { id: 9 }, chat: { id: 1 } },
    });
    const p3 = worker.handleUpdate('bot2', {
      update_id: 3,
      message: { message_id: 3, text: 'c', from: { id: 9 }, chat: { id: 2 } },
    });

    await vi.waitFor(() => expect(active).toBe(2)); // bot1 first + bot2
    openGate();
    await Promise.all([p1, p2, p3]);

    expect(maxActive).toBe(2); // bot1's updates never overlapped
  });

  it('disconnect in webhook mode removes the webhook and stops the bot', async () => {
    const { worker } = makeTelegramWorker();
    await connectWith(worker, {
      token: '123:bot-token',
      botId: 'bot1',
      webhookMode: true,
    });
    const bot = latestBot();

    await worker.disconnect('bot1');

    expect(bot?.api.deleteWebhook).toHaveBeenCalled();
    expect(bot?.stopped).toBe(true);
    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
  });
});
