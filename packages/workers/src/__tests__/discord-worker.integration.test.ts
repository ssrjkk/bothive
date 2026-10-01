import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordWorker } from '../discord/worker.js';
import { flushLogs } from '../log-batcher.js';
import { disconnectLogPublisher } from '../log-publisher.js';
import { ensureTestUser, TEST_OWNER_ID } from './helpers/tenancy.js';

interface FakeDiscordClient {
  login: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  user: { tag: string; id: string } | null;
  channels: {
    fetch: ReturnType<typeof vi.fn>;
  };
}

const discordMock = vi.hoisted(() => {
  const instances: FakeDiscordClient[] = [];
  return { instances };
});

vi.mock('discord.js', () => {
  class FakeClient {
    login: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    user: { tag: string; id: string } | null;
    channels: {
      fetch: ReturnType<typeof vi.fn>;
    };
    constructor(_opts: unknown) {
      this.login = vi.fn().mockResolvedValue('token');
      this.destroy = vi.fn().mockResolvedValue(undefined);
      this.on = vi.fn();
      this.once = vi.fn().mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'ready') {
          setTimeout(() => cb({ user: { tag: 'Bot#1234' } }), 0);
        }
      });
      this.user = { tag: 'Bot#1234', id: 'bot-id' };
      this.channels = {
        fetch: vi.fn(),
      };
      discordMock.instances.push(this as unknown as FakeDiscordClient);
    }
  }
  return {
    Client: FakeClient,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      MessageContent: 4,
      GuildMessageReactions: 8,
      GuildMembers: 16,
      DirectMessages: 32,
    },
    Events: {
      ClientReady: 'ready',
      MessageCreate: 'messageCreate',
      MessageReactionAdd: 'messageReactionAdd',
      GuildMemberAdd: 'guildMemberAdd',
    },
    Partials: { Message: 0, Channel: 1, Reaction: 2 },
  };
});

vi.mock('../webhooks.js', () => ({ dispatchWebhooks: vi.fn() }));
vi.mock('@bothive/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bothive/core')>();
  return { ...mod, decryptCredential: vi.fn((value: unknown) => value) };
});

function latestClient(): FakeDiscordClient | undefined {
  return discordMock.instances[discordMock.instances.length - 1];
}

const CREDS = { botId: 'bot1', token: 'discord-token' };

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

const instances: DiscordWorker[] = [];

function makeWorker(): { worker: DiscordWorker; events: unknown[] } {
  const worker = new DiscordWorker(REDIS_URL);
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
  'bothive:*discord*',
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

const DISCORD_BOT_IDS = ['bot1'];

describe('DiscordWorker adapter', () => {
  beforeEach(async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    discordMock.instances.length = 0;
    await flushLogs();
    await flushRedis();
    const { prisma } = await import('../prisma.js');
    await prisma.log.deleteMany({ where: { botId: { in: DISCORD_BOT_IDS } } });
    await prisma.bot.deleteMany({ where: { id: { in: DISCORD_BOT_IDS } } });
    await prisma.account.deleteMany({ where: { platform: 'discord' } });
    await ensureTestUser();
    await prisma.account.upsert({
      where: { id: 'discord-acc1' },
      update: {},
      create: {
        id: 'discord-acc1',
        name: 'Discord Test Account',
        platform: 'discord',
        token: 'tok',
        ownerId: TEST_OWNER_ID,
      },
    });
    for (const id of DISCORD_BOT_IDS) {
      await prisma.bot.upsert({
        where: { id },
        update: { status: 'idle' },
        create: {
          id,
          name: 'Discord Bot',
          platform: 'discord',
          accountId: 'discord-acc1',
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
        client: { destroy(): Promise<void> } | null;
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
      if (state.client) await state.client.destroy().catch(() => {});
      await state.worker.close().catch(() => {});
      await state.queue.close().catch(() => {});
    }
    instances.length = 0;
    discordMock.instances.length = 0;
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

  it('rejects connect when token is missing', async () => {
    const { worker } = makeWorker();
    await expect(worker.connect({ botId: 'bot1' })).rejects.toThrow(/Missing token or botId/i);
  });

  it('executes sendMessage action', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    const mockChannel = {
      send: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      isTextBased: () => true,
    };
    client!.channels.fetch.mockResolvedValue(mockChannel);

    await worker.executeAction('bot1', {
      type: 'sendMessage',
      payload: { channelId: 'channel-1', text: 'hello discord' },
    });

    expect(client!.channels.fetch).toHaveBeenCalledWith('channel-1');
    expect(mockChannel.send).toHaveBeenCalledWith('hello discord');
  });

  it('executes addReaction action', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    const mockMessage = {
      react: vi.fn().mockResolvedValue(undefined),
    };
    const mockChannel = {
      messages: {
        fetch: vi.fn().mockResolvedValue(mockMessage),
      },
      isTextBased: () => true,
    };
    client!.channels.fetch.mockResolvedValue(mockChannel);

    await worker.executeAction('bot1', {
      type: 'addReaction',
      payload: { channelId: 'channel-1', messageId: 'msg-1', emoji: '👍' },
    });

    expect(mockChannel.messages.fetch).toHaveBeenCalledWith('msg-1');
    expect(mockMessage.react).toHaveBeenCalledWith('👍');
  });

  it('rejects unknown actions and actions on a disconnected bot', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    await expect(worker.executeAction('bot1', { type: 'nope', payload: {} })).rejects.toThrow(
      /Unknown action/i,
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
    expect(latestClient()?.destroy).toHaveBeenCalled();
  });
});
