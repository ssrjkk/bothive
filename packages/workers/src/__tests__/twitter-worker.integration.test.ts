import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwitterWorker } from '../twitter/worker.js';

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

const redisMock = vi.hoisted(() => ({
  state: { leaderKey: 'bothive:leader:twitter', holder: null as string | null },
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
    log: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));
vi.mock('../log-publisher.js', () => ({ publishLog: vi.fn() }));
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

function makeWorker(): { worker: TwitterWorker; events: unknown[] } {
  const worker = new TwitterWorker('redis://fake:6379');
  const events: unknown[] = [];
  worker.onEvent((event) => events.push(event));
  return { worker, events };
}

describe('TwitterWorker adapter', () => {
  beforeEach(() => {
    twMock.instances.length = 0;
  });

  afterEach(() => {
    twMock.instances.length = 0;
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
    await vi.advanceTimersByTimeAsync(60000);
    expect(events).toHaveLength(0);

    // Second poll emits the not-yet-seen tweet.
    client?.v2.search.mockReturnValue(
      tweets(
        { id: 't1', text: 'hello', author_id: 'a1' },
        { id: 't2', text: 'hi again', author_id: 'a2', conversation_id: 'cv2' },
      ),
    );
    await vi.advanceTimersByTimeAsync(60000);

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
    await vi.advanceTimersByTimeAsync(60000);
    expect(client?.v2.me).toHaveBeenCalledTimes(1);

    // Next ticks skip work while paused.
    await vi.advanceTimersByTimeAsync(60000);
    expect(client?.v2.me).toHaveBeenCalledTimes(1);

    // After the pause window elapses polling resumes.
    await vi.advanceTimersByTimeAsync(900000);
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
    await vi.advanceTimersByTimeAsync(60000);
    expect(latestClient()?.v2.me).not.toHaveBeenCalled();
  });
});
