import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YoutubeWorker } from '../youtube/worker.js';
import { ensureTestUser, TEST_OWNER_ID } from './helpers/tenancy.js';

interface FakeYoutubeClient {
  commentThreads: { list: ReturnType<typeof vi.fn> };
  comments: { insert: ReturnType<typeof vi.fn> };
}

const ytMock = vi.hoisted(() => {
  const instances: FakeYoutubeClient[] = [];
  return { instances };
});

vi.mock('googleapis', () => {
  class FakeOAuth2 {
    setCredentials = vi.fn();
  }
  return {
    google: {
      auth: { OAuth2: FakeOAuth2 },
      youtube: vi.fn(() => {
        const client: FakeYoutubeClient = {
          commentThreads: { list: vi.fn() },
          comments: { insert: vi.fn() },
        };
        ytMock.instances.push(client);
        return client;
      }),
    },
    youtube_v3: {},
  };
});

vi.mock('../webhooks.js', () => ({ dispatchWebhooks: vi.fn() }));
vi.mock('@bothive/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bothive/core')>();
  return { ...mod, decryptCredential: vi.fn((value: unknown) => value) };
});

/** Real event-loop turns so real Redis/DB chains started by fake-timer callbacks settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    const r = await redisClient();
    await r.set('bothive:youtube:settle', '1');
    await r.quit().catch(() => undefined);
  }
}

/** Advances fake timers and then yields real I/O so pending Redis/DB work completes. */
async function advance(ms: number): Promise<void> {
  let remaining = ms;
  while (remaining > 0) {
    const step = Math.min(remaining, 60_000);
    await vi.advanceTimersByTimeAsync(step);
    await settle();
    remaining -= step;
  }
}

function latestClient(): FakeYoutubeClient | undefined {
  return ytMock.instances[ytMock.instances.length - 1];
}

function commentItem(commentId: string, text: string, author: string, videoId: string) {
  return {
    snippet: {
      videoId,
      topLevelComment: {
        id: commentId,
        snippet: { textDisplay: text, authorDisplayName: author },
      },
    },
  };
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const instances: YoutubeWorker[] = [];

/** Constructs a real BullMQ-backed YoutubeWorker and tracks it for afterEach teardown. */
function makeWorker(): { worker: YoutubeWorker; events: unknown[] } {
  const worker = new YoutubeWorker(REDIS_URL);
  instances.push(worker);
  const events: unknown[] = [];
  worker.onEvent((event) => {
    events.push(event);
    return Promise.resolve();
  });
  return { worker, events };
}

async function redisClient() {
  const { Redis } = await import('ioredis');
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
}

const REDIS_PATTERNS = [
  'bothive:leader:*',
  'bothive:outbound:*',
  'bothive:health:*',
  'bothive:youtube*',
];

async function flushRedis(): Promise<void> {
  const redis = await redisClient();
  for (const pattern of REDIS_PATTERNS) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
}

const YT_BOT_IDS = ['bot1'];

beforeEach(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  ytMock.instances.length = 0;
  await flushRedis();
  const { prisma } = await import('../prisma.js');
  await prisma.log.deleteMany({ where: { botId: { in: YT_BOT_IDS } } });
  await prisma.bot.deleteMany({ where: { id: { in: YT_BOT_IDS } } });
  await prisma.account.deleteMany({ where: { platform: 'youtube' } });
  await ensureTestUser();
  await prisma.account.upsert({
    where: { id: 'youtube-acc1' },
    update: {},
    create: {
      id: 'youtube-acc1',
      name: 'YouTube Test Account',
      platform: 'youtube',
      apiKey: 'api-key',
      ownerId: TEST_OWNER_ID,
    },
  });
  for (const id of YT_BOT_IDS) {
    await prisma.bot.upsert({
      where: { id },
      update: { status: 'idle' },
      create: {
        id,
        name: 'YouTube Bot',
        platform: 'youtube',
        accountId: 'youtube-acc1',
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
      pollingTimers: Map<string, NodeJS.Timeout>;
      reconnectTimers: Map<string, NodeJS.Timeout>;
      leaderTimer?: NodeJS.Timeout;
      reconcileTimer?: NodeJS.Timeout;
      worker: { close(): Promise<void> };
      queue: { close(): Promise<void> };
    };
    for (const t of state.pollingTimers.values()) clearInterval(t);
    state.pollingTimers.clear();
    for (const t of state.reconnectTimers.values()) clearTimeout(t);
    state.reconnectTimers.clear();
    if (state.leaderTimer) clearInterval(state.leaderTimer);
    if (state.reconcileTimer) clearInterval(state.reconcileTimer);
    await state.worker.close().catch(() => {});
    await state.queue.close().catch(() => {});
  }
  instances.length = 0;
  ytMock.instances.length = 0;
  await flushRedis();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const CREDS = { botId: 'bot1', apiKey: 'api-key' };

describe('YoutubeWorker adapter', () => {
  it('connects with an API key and marks the bot running', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);

    expect(latestClient()).toBeDefined();
    expect(worker.isConnected('bot1')).toBe(true);
    expect(worker.getStatus('bot1')).toBe('running');
  });

  it('connects with OAuth2 when refresh token credentials are present', async () => {
    const { worker } = makeWorker();
    await worker.connect({
      botId: 'bot1',
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'cs',
    });

    expect(latestClient()).toBeDefined();
    expect(worker.isConnected('bot1')).toBe(true);
  });

  it('rejects connect when credentials are missing', async () => {
    const { worker } = makeWorker();
    await expect(worker.connect({ botId: 'bot1' })).rejects.toThrow(/Missing YouTube credentials/i);
    await expect(worker.connect({ apiKey: 'k' })).rejects.toThrow(/Missing botId/i);
  });

  it('polls comment threads and emits only new comments', async () => {
    vi.useFakeTimers();
    const { worker, events } = makeWorker();
    await worker.connect({ ...CREDS, channelId: 'ch1' });

    const client = latestClient();
    // First poll seeds the dedup set (no emission).
    client?.commentThreads.list.mockResolvedValue({
      data: { items: [commentItem('c1', 'hello', 'alice', 'v1')] },
    });
    await advance(30000);
    expect(events).toHaveLength(0);

    // Second poll emits only the not-yet-seen comment.
    client?.commentThreads.list.mockResolvedValue({
      data: {
        items: [
          commentItem('c1', 'hello', 'alice', 'v1'),
          commentItem('c2', 'hi again', 'bob', 'v1'),
        ],
      },
    });
    await advance(30000);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      botId: 'bot1',
      platform: 'youtube',
      type: 'comment',
      payload: {
        commentId: 'c2',
        text: 'hi again',
        author: 'bob',
        videoId: 'v1',
        channelId: 'ch1',
      },
    });
  });

  it('does not set up polling without a channelId', async () => {
    vi.useFakeTimers();
    const { worker, events } = makeWorker();
    await worker.connect(CREDS);

    await advance(120000);
    expect(events).toHaveLength(0);
    expect(latestClient()?.commentThreads.list).not.toHaveBeenCalled();
  });

  it('executes comment actions against the YouTube API', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    await worker.executeAction('bot1', {
      type: 'replyComment',
      payload: { parentId: 'p1', text: 'thanks' },
    });
    await worker.executeAction('bot1', {
      type: 'setComment',
      payload: { videoId: 'v1', text: 'great video' },
    });
    await worker.executeAction('bot1', { type: 'listComments', payload: { videoId: 'v1' } });

    expect(client?.comments.insert).toHaveBeenNthCalledWith(1, {
      part: ['snippet'],
      requestBody: { snippet: { parentId: 'p1', textOriginal: 'thanks' } },
    });
    expect(client?.comments.insert).toHaveBeenNthCalledWith(2, {
      part: ['snippet'],
      requestBody: { snippet: { videoId: 'v1', textOriginal: 'great video' } },
    });
    expect(client?.commentThreads.list).toHaveBeenCalledWith({
      part: ['snippet'],
      videoId: 'v1',
      maxResults: 20,
    });
  });

  it('rejects reactions as unsupported on YouTube', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    await expect(
      worker.executeAction('bot1', { type: 'react', payload: { chatId: 1, messageId: 2 } }),
    ).rejects.toThrow(/not supported on YouTube/i);
  });

  it('rejects unknown actions and actions on a disconnected bot', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    await expect(worker.executeAction('bot1', { type: 'nope', payload: {} })).rejects.toThrow(
      /Unknown action/i,
    );
    await expect(
      worker.executeAction('ghost', { type: 'replyComment', payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });

  it('disconnect clears polling and state', async () => {
    vi.useFakeTimers();
    const { worker } = makeWorker();
    await worker.connect({ ...CREDS, channelId: 'ch1' });

    await worker.disconnect('bot1');

    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
    await advance(30000);
    expect(latestClient()?.commentThreads.list).not.toHaveBeenCalled();
  });
});
