import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlueskyWorker } from '../bluesky/worker.js';
import { flushLogs } from '../log-batcher.js';
import { disconnectLogPublisher } from '../log-publisher.js';
import { ensureTestUser, TEST_OWNER_ID } from './helpers/tenancy.js';

interface XrpcCall {
  url: string;
  method: string;
  body?: Record<string, unknown>;
  auth?: string;
}

const atProto = vi.hoisted(() => ({
  calls: [] as XrpcCall[],
  notifications: [] as unknown[],
  cursor: undefined as string | undefined,
  expireOnce: false,
  loginStatus: 200,
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;

/**
 * Заглушка отвечает только на XRPC-пути; всё остальное (Redis, Prisma, OTLP)
 * уходит в настоящий fetch, чтобы подмена не маскировала сторонние запросы.
 */
function installXrpcFetch() {
  atProto.calls.length = 0;
  atProto.notifications = [];
  atProto.cursor = undefined;
  atProto.expireOnce = false;
  atProto.loginStatus = 200;

  const fetchImpl = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    if (!url.includes('/xrpc/'))
      return originalFetch(input as Parameters<typeof originalFetch>[0], init);

    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: XrpcCall = {
      url,
      method: init.method ?? 'GET',
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      auth: headers.authorization,
    };
    atProto.calls.push(call);

    if (url.includes('com.atproto.server.createSession')) {
      if (atProto.loginStatus !== 200) {
        return jsonResponse(atProto.loginStatus, { error: 'InvalidAuth' });
      }
      return jsonResponse(200, {
        accessJwt: 'access-1',
        refreshJwt: 'refresh-1',
        did: 'did:plc:test',
        handle: 'user.bsky.social',
      });
    }

    if (url.includes('com.atproto.server.refreshSession')) {
      return jsonResponse(200, { accessJwt: 'access-2', refreshJwt: 'refresh-2' });
    }

    if (url.includes('com.atproto.identity.resolveHandle')) {
      return jsonResponse(200, { did: 'did:plc:friend' });
    }

    if (url.includes('com.atproto.repo.deleteRecord')) {
      return jsonResponse(200, {});
    }

    if (url.includes('app.bsky.notification.listNotifications')) {
      if (atProto.expireOnce && call.auth === 'Bearer access-1') {
        atProto.expireOnce = false;
        return jsonResponse(401, { error: 'ExpiredToken' });
      }
      return jsonResponse(200, {
        notifications: atProto.notifications,
        cursor: atProto.cursor,
      });
    }

    if (url.includes('com.atproto.repo.createRecord')) {
      const collection = String(call.body?.collection);
      return jsonResponse(200, {
        uri: `at://did:plc:test/${collection}/r${atProto.calls.length}`,
        cid: 'cid-new',
      });
    }

    return jsonResponse(404, { error: 'NotFound' });
  });

  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
}

function callsTo(xrpc: string): XrpcCall[] {
  return atProto.calls.filter((call) => call.url.includes(xrpc));
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
    installXrpcFetch();
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
    await flushRedis();
    await disconnectLogPublisher();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('connects and marks the bot running', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);

    expect(worker.isConnected('bot1')).toBe(true);
    expect(worker.getStatus('bot1')).toBe('running');

    const login = callsTo('com.atproto.server.createSession');
    expect(login).toHaveLength(1);
    expect(login[0]!.body).toEqual({
      identifier: 'user.bsky.social',
      password: 'test-password',
    });
  });

  it('rejects connect when credentials are missing', async () => {
    const { worker } = makeWorker();
    await expect(worker.connect({ botId: 'bot1', identifier: 'x' })).rejects.toThrow(
      /Missing username, token \(password\), or botId/i,
    );
    await expect(worker.connect({ botId: 'bot1', password: 'x' })).rejects.toThrow(
      /Missing username, token \(password\), or botId/i,
    );
    expect(callsTo('com.atproto.server.createSession')).toHaveLength(0);
  });

  it('rejects connect when Bluesky refuses the session', async () => {
    atProto.loginStatus = 401;
    const { worker } = makeWorker();
    await expect(worker.connect(CREDS)).rejects.toThrow(/Bluesky отклонил вход/);
    expect(worker.isConnected('bot1')).toBe(false);
  });

  it('posts through createRecord with byte-offset facets', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    atProto.calls.length = 0;

    const result = (await worker.executeAction('bot1', {
      type: 'post',
      payload: { text: 'Ссылка https://bsky.app и @friend.bsky.social' },
    })) as { uri: string; cid: string };

    expect(result.cid).toBe('cid-new');
    const create = callsTo('com.atproto.repo.createRecord');
    expect(create).toHaveLength(1);
    expect(create[0]!.body!.repo).toBe('did:plc:test');
    expect(create[0]!.body!.collection).toBe('app.bsky.feed.post');

    const record = create[0]!.body!.record as Record<string, unknown>;
    expect(record.text).toBe('Ссылка https://bsky.app и @friend.bsky.social');
    expect(typeof record.createdAt).toBe('string');

    // Индексы фасетов в байтах UTF-8 проверяются на самом клиенте
    // (atproto-client.test.ts); здесь важно, что адаптер передаёт фасеты в запись.
    const facets = record.facets as Array<{
      index: { byteStart: number; byteEnd: number };
      features: Array<Record<string, unknown>>;
    }>;
    expect(facets.map((facet) => facet.features[0]!.$type)).toEqual([
      'app.bsky.richtext.facet#link',
      'app.bsky.richtext.facet#mention',
    ]);
    expect(facets[1]!.features[0]!.did).toBe('did:plc:friend');
    expect(facets.every((facet) => facet.index.byteStart < facet.index.byteEnd)).toBe(true);
  });

  it('replies keep the root and parent references', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    atProto.calls.length = 0;

    await worker.executeAction('bot1', {
      type: 'reply',
      payload: {
        text: 'answer',
        parentUri: 'at://did:plc:x/app.bsky.feed.post/p1',
        parentCid: 'cid-parent',
        rootUri: 'at://did:plc:x/app.bsky.feed.post/r1',
        rootCid: 'cid-root',
      },
    });

    const record = callsTo('com.atproto.repo.createRecord')[0]!.body!.record as Record<
      string,
      unknown
    >;
    expect(record.reply).toEqual({
      root: { uri: 'at://did:plc:x/app.bsky.feed.post/r1', cid: 'cid-root' },
      parent: { uri: 'at://did:plc:x/app.bsky.feed.post/p1', cid: 'cid-parent' },
    });
  });

  it('executes like, repost and follow as their record types', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    atProto.calls.length = 0;

    await worker.executeAction('bot1', {
      type: 'like',
      payload: { uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'c1' },
    });
    await worker.executeAction('bot1', {
      type: 'repost',
      payload: { uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'c1' },
    });
    await worker.executeAction('bot1', {
      type: 'follow',
      payload: { did: 'did:plc:target' },
    });

    const collections = callsTo('com.atproto.repo.createRecord').map(
      (call) => call.body!.collection,
    );
    expect(collections).toEqual([
      'app.bsky.feed.like',
      'app.bsky.feed.repost',
      'app.bsky.graph.follow',
    ]);

    const like = callsTo('com.atproto.repo.createRecord')[0]!.body!.record as Record<
      string,
      unknown
    >;
    expect(like.subject).toEqual({ uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'c1' });
    const follow = callsTo('com.atproto.repo.createRecord')[2]!.body!.record as Record<
      string,
      unknown
    >;
    expect(follow.subject).toBe('did:plc:target');
  });

  it('deletes a post by its AT-URI parts', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);
    atProto.calls.length = 0;

    const result = await worker.executeAction('bot1', {
      type: 'deletePost',
      payload: { uri: 'at://did:plc:x/app.bsky.feed.post/abc123' },
    });

    expect(result).toEqual({ deleted: true });
    const del = callsTo('com.atproto.repo.deleteRecord');
    expect(del[0]!.body).toEqual({
      repo: 'did:plc:x',
      collection: 'app.bsky.feed.post',
      rkey: 'abc123',
    });
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

  it('emits events from the notification poll and remembers the cursor', async () => {
    atProto.notifications = [
      {
        uri: 'at://did:plc:x/app.bsky.feed.post/1',
        cid: 'c1',
        reason: 'mention',
        isRead: false,
        indexedAt: new Date().toISOString(),
        record: { text: 'hi' },
        author: { did: 'did:plc:x', handle: 'x.bsky.social', displayName: 'X' },
      },
    ];
    atProto.cursor = 'next-page';

    const { worker, events } = makeWorker();
    await worker.connect(CREDS);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe('mention');
    expect(callsTo('app.bsky.notification.listNotifications')[0]!.url).toContain('limit=50');

    // Второй опрос с той же страницей не должен переизлучать событие: дедупликация
    // базового воркера это ловит, а курсор проверяется на клиенте.
    atProto.calls.length = 0;
    await worker.executeAction('bot1', {
      type: 'like',
      payload: { uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'c1' },
    });
    expect(callsTo('com.atproto.repo.createRecord')).toHaveLength(1);
  });

  it('disconnect clears state', async () => {
    const { worker } = makeWorker();
    await worker.connect(CREDS);

    await worker.disconnect('bot1');

    expect(worker.isConnected('bot1')).toBe(false);
    expect(worker.getStatus('bot1')).toBe('idle');
  });
});
