import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlueskyWorker } from '../bluesky/worker.js';
import { flushLogs } from '../log-batcher.js';
import { disconnectLogPublisher } from '../log-publisher.js';
import { ensureTestUser, TEST_OWNER_ID } from './helpers/tenancy.js';

interface FakeBlueskyAgent {
  login: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  like: ReturnType<typeof vi.fn>;
  repost: ReturnType<typeof vi.fn>;
  follow: ReturnType<typeof vi.fn>;
  getTimeline: ReturnType<typeof vi.fn>;
  getNotifications: ReturnType<typeof vi.fn>;
}

const blueskyMock = vi.hoisted(() => {
  const instances: FakeBlueskyAgent[] = [];
  return { instances };
});

vi.mock('@atproto/api', () => {
  class FakeBskyAgent {
    login: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    like: ReturnType<typeof vi.fn>;
    repost: ReturnType<typeof vi.fn>;
    follow: ReturnType<typeof vi.fn>;
    getTimeline: ReturnType<typeof vi.fn>;
    getNotifications: ReturnType<typeof vi.fn>;
    constructor(_opts: unknown) {
      this.login = vi.fn().mockResolvedValue(undefined);
      this.post = vi
        .fn()
        .mockResolvedValue({ uri: 'at://did:plc:test/app.bsky.feed.post/123', cid: 'bafytest' });
      this.like = vi.fn().mockResolvedValue({ uri: 'at://did:plc:test/app.bsky.feed.like/123' });
      this.repost = vi
        .fn()
        .mockResolvedValue({ uri: 'at://did:plc:test/app.bsky.feed.repost/123' });
      this.follow = vi
        .fn()
        .mockResolvedValue({ uri: 'at://did:plc:test/app.bsky.graph.follow/123' });
      this.getTimeline = vi.fn().mockResolvedValue({ data: { feed: [] } });
      this.getNotifications = vi.fn().mockResolvedValue({ data: { notifications: [] } });
      blueskyMock.instances.push(this as unknown as FakeBlueskyAgent);
    }
  }
  class FakeRichText {
    text: string;
    facets: unknown[];
    constructor(opts: { text: string }) {
      this.text = opts.text;
      this.facets = [];
    }
    async detectFacets(_agent: unknown): Promise<void> {
      // no-op for tests
    }
  }
  return { BskyAgent: FakeBskyAgent, RichText: FakeRichText };
});

vi.mock('../webhooks.js', () => ({ dispatchWebhooks: vi.fn() }));
vi.mock('@bothive/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bothive/core')>();
  return { ...mod, decryptCredential: vi.fn((value: unknown) => value) };
});

function latestClient(): FakeBlueskyAgent | undefined {
  return blueskyMock.instances[blueskyMock.instances.length - 1];
}

const CREDS = {
  botId: 'bot1',
  username: 'user.bsky.social',
  token: 'test-password',
};

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

const instances: BlueskyWorker[] = [];

function makeWorker(): { worker: BlueskyWorker; events: unknown[] } {
  const worker = new BlueskyWorker(REDIS_URL);
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
  'bothive:*bluesky*',
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

const BLUESKY_BOT_IDS = ['bot1'];

describe('BlueskyWorker adapter', () => {
  beforeEach(async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    blueskyMock.instances.length = 0;
    await flushLogs();
    await flushRedis();
    const { prisma } = await import('../prisma.js');
    await prisma.log.deleteMany({ where: { botId: { in: BLUESKY_BOT_IDS } } });
    await prisma.bot.deleteMany({ where: { id: { in: BLUESKY_BOT_IDS } } });
    await prisma.account.deleteMany({ where: { platform: 'bluesky' } });
    await ensureTestUser();
    await prisma.account.upsert({
      where: { id: 'bluesky-acc1' },
      update: {},
      create: {
        id: 'bluesky-acc1',
        name: 'Bluesky Test Account',
        platform: 'bluesky',
        token: 'tok',
        ownerId: TEST_OWNER_ID,
      },
    });
    for (const id of BLUESKY_BOT_IDS) {
      await prisma.bot.upsert({
        where: { id },
        update: { status: 'idle' },
        create: {
          id,
          name: 'Bluesky Bot',
          platform: 'bluesky',
          accountId: 'bluesky-acc1',
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
        agent: unknown;
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
      await state.worker.close().catch(() => {});
      await state.queue.close().catch(() => {});
    }
    instances.length = 0;
    blueskyMock.instances.length = 0;
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

  it('rejects connect when credentials are missing', async () => {
    const { worker } = makeWorker();
    await expect(worker.connect({ botId: 'bot1', identifier: 'x' })).rejects.toThrow(
      /Missing username, token \(password\), or botId/i,
    );
    await expect(worker.connect({ botId: 'bot1', password: 'x' })).rejects.toThrow(
      /Missing username, token \(password\), or botId/i,
    );
  });

  it('executes post action', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    await worker.executeAction('bot1', {
      type: 'post',
      payload: { text: 'hello bluesky' },
    });

    expect(client!.post).toHaveBeenCalledWith({
      text: 'hello bluesky',
      facets: [],
      createdAt: expect.any(String),
    });
  });

  it('executes like action', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    await worker.executeAction('bot1', {
      type: 'like',
      payload: { uri: 'at://did:plc:test/app.bsky.feed.post/123', cid: 'bafytest' },
    });

    expect(client!.like).toHaveBeenCalledWith(
      'at://did:plc:test/app.bsky.feed.post/123',
      'bafytest',
    );
  });

  it('executes repost action', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    await worker.executeAction('bot1', {
      type: 'repost',
      payload: { uri: 'at://did:plc:test/app.bsky.feed.post/123', cid: 'bafytest' },
    });

    expect(client!.repost).toHaveBeenCalledWith(
      'at://did:plc:test/app.bsky.feed.post/123',
      'bafytest',
    );
  });

  it('executes follow action', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    await worker.executeAction('bot1', {
      type: 'follow',
      payload: { did: 'did:plc:target' },
    });

    expect(client!.follow).toHaveBeenCalledWith('did:plc:target');
  });

  it('rejects unknown actions and actions on a disconnected bot', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    await expect(worker.executeAction('bot1', { type: 'nope', payload: {} })).rejects.toThrow(
      /Unknown Bluesky action/i,
    );
    await expect(worker.executeAction('ghost', { type: 'post', payload: {} })).rejects.toThrow(
      /not connected/i,
    );
  });

  it('disconnect clears state', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);

    await worker.disconnect('bot1');

    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
  });
});
