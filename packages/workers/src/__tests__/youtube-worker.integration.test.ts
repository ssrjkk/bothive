import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YoutubeWorker } from '../youtube/worker.js';

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

const redisMock = vi.hoisted(() => ({
  state: { leaderKey: 'bothive:leader:youtube', holder: null as string | null },
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

function makeWorker(): { worker: YoutubeWorker; events: unknown[] } {
  const worker = new YoutubeWorker('redis://fake:6379');
  const events: unknown[] = [];
  worker.onEvent((event) => events.push(event));
  return { worker, events };
}

const CREDS = { botId: 'bot1', apiKey: 'api-key' };

describe('YoutubeWorker adapter', () => {
  beforeEach(() => {
    ytMock.instances.length = 0;
  });

  afterEach(() => {
    ytMock.instances.length = 0;
    vi.useRealTimers();
  });

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
    await vi.advanceTimersByTimeAsync(30000);
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
    await vi.advanceTimersByTimeAsync(30000);

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

    await vi.advanceTimersByTimeAsync(120000);
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
    await vi.advanceTimersByTimeAsync(30000);
    expect(latestClient()?.commentThreads.list).not.toHaveBeenCalled();
  });
});
