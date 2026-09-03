import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwitterWorker } from '../twitter/worker.js';
import { flushLogs } from '../log-batcher.js';
import { disconnectLogPublisher } from '../log-publisher.js';
import { ensureTestUser, TEST_OWNER_ID } from './helpers/tenancy.js';

/** Real event-loop turns so real Redis/DB chains started by fake-timer callbacks settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    const r = await redisClient();
    await r.set('bothive:twitter:settle', '1');
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

interface FakeTwitterClient {
  v2: {
    me: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    followers: ReturnType<typeof vi.fn>;
    tweet: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
    like: ReturnType<typeof vi.fn>;
    retweet: ReturnType<typeof vi.fn>;
    follow: ReturnType<typeof vi.fn>;
    unfollow: ReturnType<typeof vi.fn>;
  };
}

const twMock = vi.hoisted(() => {
  const instances: FakeTwitterClient[] = [];
  return { instances };
});

vi.mock('twitter-api-v2', () => {
  class FakeTwitterApi {
    v2: FakeTwitterClient['v2'];
    constructor(_opts: unknown) {
      this.v2 = {
        me: vi.fn(),
        search: vi.fn(),
        followers: vi.fn(),
        tweet: vi.fn(),
        reply: vi.fn(),
        like: vi.fn(),
        retweet: vi.fn(),
        follow: vi.fn(),
        unfollow: vi.fn(),
      };
      twMock.instances.push({ v2: this.v2 });
    }
  }
  return { TwitterApi: FakeTwitterApi };
});

vi.mock('../webhooks.js', () => ({ dispatchWebhooks: vi.fn() }));
vi.mock('@bothive/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bothive/core')>();
  return { ...mod, decryptCredential: vi.fn((value: unknown) => value) };
});

function latestClient(): FakeTwitterClient | undefined {
  return twMock.instances[twMock.instances.length - 1];
}

function tweets(...items: Record<string, unknown>[]): AsyncGenerator<Record<string, unknown>> {
  return (async function* () {
    for (const t of items) yield t;
  })();
}

const empty = (): AsyncGenerator<never> =>
  (async function* () {
    /* no items */
  })();

const CREDS = { botId: 'bot1', clientId: 'appkey', clientSecret: 'appsecret' };
const POLL_CREDS = { ...CREDS, accessToken: 'at', accessSecret: 'as' };

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const instances: TwitterWorker[] = [];

function makeWorker(): { worker: TwitterWorker; events: unknown[] } {
  const worker = new TwitterWorker(REDIS_URL);
  instances.push(worker);
  const events: unknown[] = [];
  worker.onEvent((event) => events.push(event));
  return { worker, events };
}

/** Accesses a private/protected method on a BaseWorker at runtime. */
function invoke<T>(worker: TwitterWorker, method: string, ...args: unknown[]): T {
  return (worker as unknown as Record<string, (...a: unknown[]) => T>)[method].call(
    worker,
    ...args,
  );
}

async function redisClient() {
  const { Redis } = await import('ioredis');
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
}

const REDIS_PATTERNS = [
  'bothive:leader:*',
  'bothive:outbound:*',
  'bothive:health:*',
  'bothive:*twitter*',
];

async function flushRedis(): Promise<void> {
  const redis = await redisClient();
  for (const pattern of REDIS_PATTERNS) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
}

const TWITTER_BOT_IDS = ['bot1'];

describe('TwitterWorker adapter', () => {
  beforeEach(async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    twMock.instances.length = 0;
    await flushLogs(); // drain any buffer left over from the previous test into the DB
    await flushRedis();
    const { prisma } = await import('../prisma.js');
    await prisma.log.deleteMany({ where: { botId: { in: TWITTER_BOT_IDS } } });
    await prisma.bot.deleteMany({ where: { id: { in: TWITTER_BOT_IDS } } });
    await prisma.account.deleteMany({ where: { platform: 'twitter' } });
    await ensureTestUser();
    await prisma.account.upsert({
      where: { id: 'twitter-acc1' },
      update: {},
      create: {
        id: 'twitter-acc1',
        name: 'Twitter Test Account',
        platform: 'twitter',
        token: 'tok',
        ownerId: TEST_OWNER_ID,
      },
    });
    for (const id of TWITTER_BOT_IDS) {
      await prisma.bot.upsert({
        where: { id },
        update: { status: 'idle' },
        create: {
          id,
          name: 'Twitter Bot',
          platform: 'twitter',
          accountId: 'twitter-acc1',
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
        streams: Map<string, NodeJS.Timeout>;
        worker: { close(): Promise<void> };
        queue: { close(): Promise<void> };
        reconnectTimers: Map<string, NodeJS.Timeout>;
        leaderTimer?: NodeJS.Timeout;
        reconcileTimer?: NodeJS.Timeout;
      };
      for (const timer of state.streams.values()) clearInterval(timer);
      state.streams.clear();
      if (state.leaderTimer) clearInterval(state.leaderTimer);
      if (state.reconcileTimer) clearInterval(state.reconcileTimer);
      for (const timer of state.reconnectTimers.values()) clearTimeout(timer);
      state.reconnectTimers.clear();
      await state.worker.close().catch(() => {});
      await state.queue.close().catch(() => {});
    }
    instances.length = 0;
    twMock.instances.length = 0;
    await flushRedis();
    await disconnectLogPublisher();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('connects without access token (app-only) and marks the bot running', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);

    expect(latestClient()).toBeDefined();
    expect(worker.isConnected('bot1')).toBe(true);
    expect(worker.getStatus('bot1')).toBe('running');
  });

  it('rejects connect when credentials are missing', async () => {
    const { worker } = makeWorker();
    await expect(worker.connect({ botId: 'bot1', clientId: 'k' })).rejects.toThrow(
      /Missing Twitter credentials/i,
    );
    await expect(worker.connect({ clientId: 'k', clientSecret: 's' })).rejects.toThrow(
      /Missing Twitter credentials/i,
    );
  });

  it('polls mentions and emits only new tweets', async () => {
    vi.useFakeTimers();
    const { worker, events } = makeWorker();
    await worker.connect(POLL_CREDS);

    const client = latestClient();
    client?.v2.me.mockResolvedValue({ data: { id: 'u1', username: 'me' } });
    client?.v2.followers.mockReturnValue(empty());

    // First poll seeds the dedup set (no emission).
    client?.v2.search.mockReturnValue(tweets({ id: 't1', text: 'hello', author_id: 'a1' }));
    await advance(60000);
    expect(events).toHaveLength(0);

    // Second poll emits the not-yet-seen tweet.
    client?.v2.search.mockReturnValue(
      tweets(
        { id: 't1', text: 'hello', author_id: 'a1' },
        { id: 't2', text: 'hi again', author_id: 'a2', conversation_id: 'cv2' },
      ),
    );
    await advance(60000);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      botId: 'bot1',
      platform: 'twitter',
      type: 'message',
      payload: { text: 'hi again', tweetId: 't2', authorId: 'a2', conversationId: 'cv2' },
    });
  });

  it('pauses polling for 15 minutes on a 429 rate limit, then resumes', async () => {
    vi.useFakeTimers();
    const { worker } = makeWorker();
    await worker.connect(POLL_CREDS);

    const client = latestClient();
    client?.v2.me.mockResolvedValue({ data: { id: 'u1', username: 'me' } });
    client?.v2.followers.mockReturnValue(empty());
    client?.v2.search.mockImplementation(() => {
      throw Object.assign(new Error('rate limited'), { code: 429 });
    });

    // First poll hits 429.
    await advance(60000);
    expect(client?.v2.me).toHaveBeenCalledTimes(1);

    // Next ticks skip work while paused.
    await advance(60000);
    expect(client?.v2.me).toHaveBeenCalledTimes(1);

    // After the pause window elapses polling resumes.
    await advance(900000);
    expect(client?.v2.me).toHaveBeenCalledTimes(2);
  });

  it('executes actions against the v2 API', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    await worker.executeAction('bot1', { type: 'tweet', payload: { text: 'hello world' } });
    await worker.executeAction('bot1', {
      type: 'reply',
      payload: { text: 'thanks', tweetId: 't1' },
    });
    await worker.executeAction('bot1', {
      type: 'like',
      payload: { userId: 'me', tweetId: 't1' },
    });
    await worker.executeAction('bot1', {
      type: 'retweet',
      payload: { userId: 'me', tweetId: 't1' },
    });
    await worker.executeAction('bot1', {
      type: 'follow',
      payload: { userId: 'me', targetUserId: 't1' },
    });
    await worker.executeAction('bot1', {
      type: 'unfollow',
      payload: { userId: 'me', targetUserId: 't1' },
    });
    await worker.executeAction('bot1', { type: 'search', payload: { query: 'q', maxResults: 5 } });

    expect(client?.v2.tweet).toHaveBeenCalledWith('hello world');
    expect(client?.v2.reply).toHaveBeenCalledWith('thanks', 't1');
    expect(client?.v2.like).toHaveBeenCalledWith('me', 't1');
    expect(client?.v2.retweet).toHaveBeenCalledWith('me', 't1');
    expect(client?.v2.follow).toHaveBeenCalledWith('me', 't1');
    expect(client?.v2.unfollow).toHaveBeenCalledWith('me', 't1');
    expect(client?.v2.search).toHaveBeenCalledWith('q', { max_results: 5 });
  });

  it('maps react to a like when userId and tweet id are present', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    const client = latestClient();

    await worker.executeAction('bot1', {
      type: 'react',
      payload: { userId: 'me', messageId: 't9' },
    });
    expect(client?.v2.like).toHaveBeenCalledWith('me', 't9');
  });

  it('rejects react without userId and tweet id', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    await expect(
      worker.executeAction('bot1', { type: 'react', payload: { userId: 'me' } }),
    ).rejects.toThrow(/requires userId and messageId/i);
  });

  it('rejects unknown actions and actions on a disconnected bot', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    await expect(worker.executeAction('bot1', { type: 'nope', payload: {} })).rejects.toThrow(
      /Unknown action/i,
    );
    await expect(worker.executeAction('ghost', { type: 'tweet', payload: {} })).rejects.toThrow(
      /not connected/i,
    );
  });

  it('disconnect clears polling and state', async () => {
    vi.useFakeTimers();
    const { worker } = makeWorker();
    await worker.connect(POLL_CREDS);

    await worker.disconnect('bot1');

    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
    await advance(60000);
    expect(latestClient()?.v2.me).not.toHaveBeenCalled();
  });
});
