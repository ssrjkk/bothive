import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwitchWorker } from '../twitch/worker.js';

// Fake tmi client: captures handlers per instance so tests can drive callbacks.
const clientMock = vi.hoisted(() => {
  const instances: {
    handlers: Map<string, (...args: unknown[]) => unknown>;
    connectCalls: number;
    disconnectCalls: number;
    say: ReturnType<typeof vi.fn>;
    timeout: ReturnType<typeof vi.fn>;
    ban: ReturnType<typeof vi.fn>;
    unban: ReturnType<typeof vi.fn>;
    slow: ReturnType<typeof vi.fn>;
    followersonly: ReturnType<typeof vi.fn>;
    emoteonly: ReturnType<typeof vi.fn>;
    subscribers: ReturnType<typeof vi.fn>;
  }[] = [];
  return { instances };
});

vi.mock('tmi.js', () => ({
  default: {
    Client: class {
      handlers = new Map<string, (...args: unknown[]) => unknown>();
      connectCalls = 0;
      disconnectCalls = 0;
      say = vi.fn();
      timeout = vi.fn();
      ban = vi.fn();
      unban = vi.fn();
      slow = vi.fn();
      followersonly = vi.fn();
      emoteonly = vi.fn();
      subscribers = vi.fn();
      constructor(_opts: unknown) {
        clientMock.instances.push(this);
      }
      on(event: string, handler: (...args: unknown[]) => unknown) {
        this.handlers.set(event, handler);
        return this;
      }
      async connect() {
        this.connectCalls += 1;
      }
      async disconnect() {
        this.disconnectCalls += 1;
      }
    },
  },
}));

const redisMock = vi.hoisted(() => ({
  state: { leaderKey: 'bothive:leader:twitch', holder: null as string | null },
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

function latestClient(): (typeof clientMock.instances)[number] | undefined {
  return clientMock.instances[clientMock.instances.length - 1];
}

const CREDENTIALS = {
  botId: 'bot1',
  username: 'mybot',
  token: 'oauth:abc',
  channel: '#mychannel',
  botIdValue: 'u1',
};

function makeWorker(): { worker: TwitchWorker; events: unknown[] } {
  const worker = new TwitchWorker('redis://fake:6379');
  const events: unknown[] = [];
  worker.onEvent((event) => events.push(event));
  return { worker, events };
}

describe('TwitchWorker adapter', () => {
  beforeEach(() => {
    clientMock.instances.length = 0;
  });

  afterEach(() => {
    clientMock.instances.length = 0;
  });

  it('connects, subscribes to events and emits chat messages', async () => {
    const { worker, events } = makeWorker();
    await worker.connect(CREDENTIALS);

    const client = latestClient();
    expect(client).toBeDefined();
    expect(client?.connectCalls).toBe(1);
    expect(client?.handlers.has('message')).toBe(true);
    expect(client?.handlers.has('subscription')).toBe(true);
    expect(client?.handlers.has('raided')).toBe(true);
    expect(worker.isConnected('bot1')).toBe(true);
    expect(worker.getStatus('bot1')).toBe('running');

    const message = client?.handlers.get('message');
    await message?.('#mychannel', { username: 'viewer1' }, 'hello everyone', false);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      botId: 'bot1',
      platform: 'twitch',
      type: 'message',
      payload: { message: 'hello everyone', username: 'viewer1', channel: '#mychannel' },
    });
  });

  it('emits a donation event when the message carries bits', async () => {
    const { worker, events } = makeWorker();
    await worker.connect(CREDENTIALS);

    const message = latestClient()?.handlers.get('message');
    await message?.('#mychannel', { username: 'viewer1', bits: '500' }, 'thanks', false);

    expect(events[0]).toMatchObject({
      type: 'donation',
      payload: { message: 'thanks', username: 'viewer1', bits: 500, amount: 5 },
    });
  });

  it('ignores messages sent by the bot itself', async () => {
    const { worker, events } = makeWorker();
    await worker.connect(CREDENTIALS);

    const message = latestClient()?.handlers.get('message');
    await message?.('#mychannel', { username: 'mybot' }, 'I am a bot', false);

    expect(events).toHaveLength(0);
  });

  it('emits subscribe, raid and host events', async () => {
    const { worker, events } = makeWorker();
    await worker.connect(CREDENTIALS);

    const client = latestClient();
    await client?.handlers.get('subscription')?.('#mychannel', 'fan1', 'prime', 'welcome', {});
    await client?.handlers.get('raided')?.('#mychannel', 'raider1', 42);
    await client?.handlers.get('hosted')?.('#mychannel', 'host1', 7, false);

    expect(events.map((e) => (e as { type: string }).type)).toEqual(['subscribe', 'raid', 'host']);
  });

  it('rejects connect when credentials are missing', async () => {
    const { worker } = makeWorker();
    await expect(
      worker.connect({ botId: 'bot1', username: 'u', token: '', channel: '#c' }),
    ).rejects.toThrow(/Missing Twitch credentials/i);
  });

  it('executes chat actions against the client', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDENTIALS);
    const client = latestClient();

    await worker.executeAction('bot1', { type: 'say', payload: { channel: '#c', message: 'hi' } });
    await worker.executeAction('bot1', {
      type: 'timeout',
      payload: { channel: '#c', username: 'x', seconds: 60, reason: 'spam' },
    });
    await worker.executeAction('bot1', {
      type: 'ban',
      payload: { channel: '#c', username: 'x', reason: 'r' },
    });
    await worker.executeAction('bot1', {
      type: 'unban',
      payload: { channel: '#c', username: 'x' },
    });
    await worker.executeAction('bot1', { type: 'slow', payload: { channel: '#c', seconds: 30 } });

    expect(client?.say).toHaveBeenCalledWith('#c', 'hi');
    expect(client?.timeout).toHaveBeenCalledWith('#c', 'x', 60, 'spam');
    expect(client?.ban).toHaveBeenCalledWith('#c', 'x', 'r');
    expect(client?.unban).toHaveBeenCalledWith('#c', 'x');
    expect(client?.slow).toHaveBeenCalledWith('#c', 30);
  });

  it('rejects reactions as unsupported on Twitch', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDENTIALS);
    await expect(
      worker.executeAction('bot1', { type: 'react', payload: { chatId: 1, messageId: 2 } }),
    ).rejects.toThrow(/not supported on Twitch/i);
  });

  it('rejects unknown actions and actions on a disconnected bot', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDENTIALS);
    await expect(worker.executeAction('bot1', { type: 'nope', payload: {} })).rejects.toThrow(
      /Unknown action/i,
    );
    await expect(worker.executeAction('ghost', { type: 'say', payload: {} })).rejects.toThrow(
      /not connected/i,
    );
  });

  it('disconnect disconnects the client and clears state', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDENTIALS);

    await worker.disconnect('bot1');

    expect(latestClient()?.disconnectCalls).toBe(1);
    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
  });
});
