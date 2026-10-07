import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackWorker } from '../slack/worker.js';
import { flushLogs } from '../log-batcher.js';
import { disconnectLogPublisher } from '../log-publisher.js';
import { ensureTestUser, TEST_OWNER_ID } from './helpers/tenancy.js';

interface FakeSlackClient {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  auth: {
    test: ReturnType<typeof vi.fn>;
  };
  chat: {
    postMessage: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  reactions: {
    add: ReturnType<typeof vi.fn>;
  };
  views: {
    open: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  event: ReturnType<typeof vi.fn>;
  client: {
    auth: {
      test: ReturnType<typeof vi.fn>;
    };
    chat: {
      postMessage: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    reactions: {
      add: ReturnType<typeof vi.fn>;
    };
    views: {
      open: ReturnType<typeof vi.fn>;
    };
  };
}

const slackMock = vi.hoisted(() => {
  const instances: FakeSlackClient[] = [];
  return { instances };
});

vi.mock('@slack/bolt', () => {
  class FakeApp {
    auth: FakeSlackClient['auth'];
    chat: FakeSlackClient['chat'];
    reactions: FakeSlackClient['reactions'];
    views: FakeSlackClient['views'];
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    event: ReturnType<typeof vi.fn>;
    client: FakeSlackClient['client'];
    constructor(_opts: unknown) {
      this.start = vi.fn().mockResolvedValue(undefined);
      this.stop = vi.fn().mockResolvedValue(undefined);
      this.on = vi.fn();
      this.event = vi.fn();
      this.auth = {
        test: vi.fn().mockResolvedValue({ user_id: 'U123' }),
      };
      this.chat = {
        postMessage: vi.fn().mockResolvedValue({ ts: '1234567890.123456', channel: 'C123' }),
        update: vi.fn().mockResolvedValue({ ts: '1234567890.123456' }),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      this.reactions = {
        add: vi.fn().mockResolvedValue(undefined),
      };
      this.views = {
        open: vi.fn().mockResolvedValue(undefined),
      };
      this.client = {
        auth: this.auth,
        chat: this.chat,
        reactions: this.reactions,
        views: this.views,
      };
      slackMock.instances.push(this as unknown as FakeSlackClient);
    }
  }
  return {
    App: FakeApp,
    LogLevel: { WARN: 'WARN' },
  };
});

vi.mock('../webhooks.js', () => ({ dispatchWebhooks: vi.fn() }));
vi.mock('@bothive/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bothive/core')>();
  return { ...mod, decryptCredential: vi.fn((value: unknown) => value) };
});

function latestClient(): FakeSlackClient | undefined {
  return slackMock.instances[slackMock.instances.length - 1];
}

const CREDS = {
  botId: 'bot1',
  token: 'xoxb-test-token',
  appToken: 'xapp-test-token',
};

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

const instances: SlackWorker[] = [];

function makeWorker(): { worker: SlackWorker; events: unknown[] } {
  const worker = new SlackWorker(REDIS_URL);
  instances.push(worker);
  const events: unknown[] = [];
  worker.onEvent((event) => events.push(event));
  return { worker, events };
}

async function redisClient() {
  const { Redis } = await import('ioredis');
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');
}

const REDIS_PATTERNS = [
  'bothive:leader:*',
  'bothive:outbound:*',
  'bothive:health:*',
  'bothive:event:dedup:*',
  'bothive:*slack*',
];

async function flushRedis(): Promise<void> {
  const redis = await redisClient();
  for (const pattern of REDIS_PATTERNS) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
  const { resetEventDedup } = await import('../base-worker.js');
  resetEventDedup();
}

const SLACK_BOT_IDS = ['bot1'];

describe('SlackWorker adapter', () => {
  beforeEach(async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    slackMock.instances.length = 0;
    await flushLogs();
    await flushRedis();
    const { prisma } = await import('../prisma.js');
    await prisma.log.deleteMany({ where: { botId: { in: SLACK_BOT_IDS } } });
    await prisma.bot.deleteMany({ where: { id: { in: SLACK_BOT_IDS } } });
    await prisma.account.deleteMany({ where: { platform: 'slack' } });
    await ensureTestUser();
    await prisma.account.upsert({
      where: { id: 'slack-acc1' },
      update: {},
      create: {
        id: 'slack-acc1',
        name: 'Slack Test Account',
        platform: 'slack',
        token: 'tok',
        ownerId: TEST_OWNER_ID,
      },
    });
    for (const id of SLACK_BOT_IDS) {
      await prisma.bot.upsert({
        where: { id },
        update: { status: 'idle' },
        create: {
          id,
          name: 'Slack Bot',
          platform: 'slack',
          accountId: 'slack-acc1',
          status: 'idle',
          config: {},
          ownerId: TEST_OWNER_ID,
        },
      });
    }
  });

  afterEach(async () => {
    for (const w of instances) {
      const state = w as unknown as {
        app: { stop(): Promise<void> } | null;
        worker: { close(): Promise<void> };
        queue: { close(): Promise<void> };
        reconnectTimers: Map<string, NodeJS.Timeout>;
        leaderTimer?: NodeJS.Timeout;
        reconcileTimer?: NodeJS.Timeout;
      };
      if (state.leaderTimer) clearInterval(state.leaderTimer);
      if (state.reconcileTimer) clearInterval(state.reconcileTimer);
      for (const timer of state.reconnectTimers.values()) clearTimeout(timer);
      state.reconnectTimers.clear();
      if (state.app) await state.app.stop().catch(() => {});
      await state.worker.close().catch(() => {});
      await state.queue.close().catch(() => {});
    }
    instances.length = 0;
    slackMock.instances.length = 0;
    await flushRedis();
    await disconnectLogPublisher();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('connects and marks the bot running', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);

    expect(latestClient()).toBeDefined();
    expect(worker.isConnected('bot1')).toBe(true);
    expect(worker.getStatus('bot1')).toBe('running');
  });

  it('rejects connect when tokens are missing', async () => {
    const { worker } = makeWorker();
    await expect(worker.connect({ botId: 'bot1' })).rejects.toThrow(/Missing token or botId/i);
    await expect(worker.connect({ token: 'x' })).rejects.toThrow(/Missing token or botId/i);
  });

  it('executes sendMessage action', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    await worker.executeAction('bot1', {
      type: 'sendMessage',
      payload: { channel: 'C123', text: 'hello slack' },
    });

    expect(client!.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'hello slack',
    });
  });

  it('executes addReaction action', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    await worker.executeAction('bot1', {
      type: 'addReaction',
      payload: { channel: 'C123', timestamp: '1234567890.123456', name: 'thumbsup' },
    });

    expect(client!.reactions.add).toHaveBeenCalledWith({
      channel: 'C123',
      timestamp: '1234567890.123456',
      name: 'thumbsup',
    });
  });

  it('executes updateMessage action', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    await worker.executeAction('bot1', {
      type: 'updateMessage',
      payload: { channel: 'C123', ts: '1234567890.123456', text: 'updated text' },
    });

    expect(client!.chat.update).toHaveBeenCalledWith({
      channel: 'C123',
      ts: '1234567890.123456',
      text: 'updated text',
    });
  });

  it('executes openModal action', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    const view = { type: 'modal', title: { type: 'plain_text', text: 'Test' } };
    await worker.executeAction('bot1', {
      type: 'openModal',
      payload: { triggerId: 'trigger-123', view },
    });

    expect(client!.views.open).toHaveBeenCalledWith({
      trigger_id: 'trigger-123',
      view,
    });
  });

  it('rejects unknown actions and actions on a disconnected bot', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    await expect(worker.executeAction('bot1', { type: 'nope', payload: {} })).rejects.toThrow(
      /Unknown Slack action/i,
    );
    await expect(
      worker.executeAction('ghost', { type: 'sendMessage', payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });

  it('disconnect clears state', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);

    await worker.disconnect('bot1');

    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
    expect(latestClient()?.stop).toHaveBeenCalled();
  });
});
