import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AtpClient, AtpError, detectFacets, type FetchLike } from '../bluesky/atproto-client.js';

interface XrpcCall {
  url: string;
  method: string;
  body?: Record<string, unknown>;
  auth?: string;
}

let calls: XrpcCall[];
let notifications: unknown[];
let loginStatus: number;
let expireOnce: boolean;
let resolveHandleStatus: number;

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Заглушка отвечает только на /xrpc/: остальной трафик (Redis, Prisma, OTLP)
 * идёт в настоящий fetch, чтобы подмена не маскировала лишние запросы.
 */
function installXrpcFetch() {
  calls = [];
  notifications = [];
  loginStatus = 200;
  expireOnce = false;
  resolveHandleStatus = 200;

  const fetchImpl = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    if (!url.includes('/xrpc/')) {
      return originalFetch(input as Parameters<typeof originalFetch>[0], init);
    }

    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: XrpcCall = {
      url,
      method: init.method ?? 'GET',
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      auth: headers.authorization,
    };
    calls.push(call);

    if (url.includes('com.atproto.server.createSession')) {
      if (loginStatus !== 200) return jsonResponse(loginStatus, { error: 'InvalidAuth' });
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
      if (resolveHandleStatus !== 200) return jsonResponse(resolveHandleStatus, { error: 'X' });
      return jsonResponse(200, { did: 'did:plc:friend' });
    }
    if (url.includes('app.bsky.notification.listNotifications')) {
      if (expireOnce && call.auth === 'Bearer access-1') {
        expireOnce = false;
        return jsonResponse(401, { error: 'ExpiredToken' });
      }
      return jsonResponse(200, { notifications, cursor: 'next-page' });
    }
    if (url.includes('com.atproto.repo.deleteRecord')) return jsonResponse(200, {});
    if (url.includes('com.atproto.repo.createRecord')) {
      const collection = String(call.body?.collection);
      return jsonResponse(200, {
        uri: `at://did:plc:test/${collection}/r${calls.length}`,
        cid: 'cid-new',
      });
    }
    if (url.includes('not-json')) return new Response('<html>nope</html>', { status: 500 });
    return jsonResponse(404, { error: 'NotFound' });
  });

  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl as unknown as FetchLike;
}

function callsTo(fragment: string): XrpcCall[] {
  return calls.filter((call) => call.url.includes(fragment));
}

async function loggedIn(): Promise<AtpClient> {
  return AtpClient.login({
    service: 'https://bsky.social/',
    identifier: 'user.bsky.social',
    password: 'app-password',
  });
}

describe('AtpClient (XRPC without the SDK)', () => {
  beforeEach(() => {
    installXrpcFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens a session with identifier and password', async () => {
    const client = await loggedIn();

    expect(client.did).toBe('did:plc:test');
    expect(client.handle).toBe('user.bsky.social');
    const login = callsTo('com.atproto.server.createSession');
    expect(login).toHaveLength(1);
    // лишний слэш в service не должен рождать //xrpc/
    expect(login[0]!.url).toBe('https://bsky.social/xrpc/com.atproto.server.createSession');
    expect(login[0]!.body).toEqual({ identifier: 'user.bsky.social', password: 'app-password' });
  });

  it('fails with the Bluesky error name when the password is wrong', async () => {
    loginStatus = 401;
    await expect(loggedIn()).rejects.toThrow(/Bluesky отклонил вход/);
  });

  it('refreshes the session once on an expired access token', async () => {
    const client = await loggedIn();
    expireOnce = true;

    const page = await client.listNotifications({ limit: 50, cursor: 'prev' });

    expect(page.notifications).toEqual([]);
    expect(page.cursor).toBe('next-page');
    expect(callsTo('com.atproto.server.refreshSession')).toHaveLength(1);
    const list = callsTo('app.bsky.notification.listNotifications');
    expect(list[0]!.auth).toBe('Bearer access-1');
    expect(list[1]!.auth).toBe('Bearer access-2');
    expect(list[1]!.url).toContain('cursor=prev');
    expect(list[1]!.url).toContain('limit=50');
  });

  it('refreshes once and surfaces the second rejection', async () => {
    const client = await loggedIn();
    // После refresh повтор запроса идёт один: второй 401 должен всплыть, а не
    // завести цикл «обнови-повтори».
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('com.atproto.server.refreshSession')) {
        return jsonResponse(200, { accessJwt: 'access-2', refreshJwt: 'refresh-2' });
      }
      return jsonResponse(401, { error: 'InvalidToken' });
    });
    vi.stubGlobal('fetch', fetchImpl);

    await expect(client.listNotifications({ limit: 1 })).rejects.toBeInstanceOf(AtpError);
    const names = (fetchImpl.mock.calls as unknown as Array<[string]>)
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/xrpc/'))
      .map((url) => url.split('/xrpc/')[1]!.split('?')[0]);
    expect(names.filter((name) => name.includes('refreshSession'))).toHaveLength(1);
    expect(
      names.filter((name) => name.includes('app.bsky.notification.listNotifications')),
    ).toHaveLength(2);
  });

  it('writes a post record with text, facets and createdAt', async () => {
    const client = await loggedIn();

    const result = await client.post({
      text: 'привет',
      facets: [
        {
          index: { byteStart: 0, byteEnd: 6 },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://x.dev' }],
        },
      ],
    });

    expect(result.cid).toBe('cid-new');
    const create = callsTo('com.atproto.repo.createRecord')[0]!;
    expect(create.body!.repo).toBe('did:plc:test');
    expect(create.body!.collection).toBe('app.bsky.feed.post');
    const record = create.body!.record as Record<string, unknown>;
    expect(record.text).toBe('привет');
    expect(record.$type).toBe('app.bsky.feed.post');
    expect(typeof record.createdAt).toBe('string');
    expect(record.facets).toHaveLength(1);
  });

  it('omits empty facets and a missing reply', async () => {
    const client = await loggedIn();
    await client.post({ text: 'только текст' });

    const record = callsTo('com.atproto.repo.createRecord')[0]!.body!.record as Record<
      string,
      unknown
    >;
    expect('facets' in record).toBe(false);
    expect('reply' in record).toBe(false);
  });

  it('writes like, repost and follow records', async () => {
    const client = await loggedIn();

    await client.like('at://did:plc:x/app.bsky.feed.post/1', 'c1');
    await client.repost('at://did:plc:x/app.bsky.feed.post/1', 'c1');
    await client.follow('did:plc:target');

    const created = callsTo('com.atproto.repo.createRecord');
    expect(created.map((call) => call.body!.collection)).toEqual([
      'app.bsky.feed.like',
      'app.bsky.feed.repost',
      'app.bsky.graph.follow',
    ]);
    expect((created[0]!.body!.record as Record<string, unknown>).subject).toEqual({
      uri: 'at://did:plc:x/app.bsky.feed.post/1',
      cid: 'c1',
    });
    expect((created[2]!.body!.record as Record<string, unknown>).subject).toBe('did:plc:target');
  });

  it('deletes a record by the parts of its AT-URI', async () => {
    const client = await loggedIn();

    await client.deleteRecord('at://did:plc:x/app.bsky.feed.post/abc123');

    expect(callsTo('com.atproto.repo.deleteRecord')[0]!.body).toEqual({
      repo: 'did:plc:x',
      collection: 'app.bsky.feed.post',
      rkey: 'abc123',
    });
  });

  it('refuses a malformed AT-URI without calling the API', async () => {
    const client = await loggedIn();
    calls.length = 0;

    await expect(client.deleteRecord('https://bsky.app/post/1')).rejects.toBeInstanceOf(AtpError);
    expect(callsTo('com.atproto.repo.deleteRecord')).toHaveLength(0);
  });

  it('surfaces a non-JSON answer as an AtpError instead of crashing', async () => {
    const client = await loggedIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>boom</html>', { status: 500 })),
    );

    await expect(client.listNotifications({ limit: 10 })).rejects.toBeInstanceOf(AtpError);
  });

  it('returns null for a handle that does not resolve', async () => {
    const client = await loggedIn();
    resolveHandleStatus = 400;

    expect(await client.resolveHandle('ghost.bsky.social')).toBeNull();
  });

  it('maps notification pages', async () => {
    const client = await loggedIn();
    notifications = [
      {
        uri: 'at://did:plc:x/app.bsky.feed.post/1',
        cid: 'c1',
        reason: 'like',
        isRead: false,
        indexedAt: '2026-10-29T00:00:00.000Z',
        record: {},
        author: { did: 'did:plc:x', handle: 'x.bsky.social' },
      },
    ];

    const page = await client.listNotifications({ limit: 5 });

    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]!.author.handle).toBe('x.bsky.social');
  });
});

describe('detectFacets', () => {
  it('indexes links, mentions and tags in UTF-8 bytes', async () => {
    const facets = await detectFacets(
      'Привет https://bsky.app @friend.bsky.social #тесты',
      async () => 'did:plc:friend',
    );

    expect(facets.map((facet) => facet.index)).toEqual([
      { byteStart: 13, byteEnd: 29 },
      { byteStart: 30, byteEnd: 49 },
      { byteStart: 50, byteEnd: 61 },
    ]);
    expect(facets.map((facet) => facet.features[0]!.$type)).toEqual([
      'app.bsky.richtext.facet#link',
      'app.bsky.richtext.facet#mention',
      'app.bsky.richtext.facet#tag',
    ]);
    expect(facets[1]!.features[0]!.did).toBe('did:plc:friend');
    expect(facets[2]!.features[0]!.tag).toBe('тесты');
  });

  it('trims sentence punctuation from a link', async () => {
    const facets = await detectFacets('см. https://example.com/a). ', async () => null);

    expect(facets).toHaveLength(1);
    expect(facets[0]!.features[0]!.uri).toBe('https://example.com/a');
    expect(facets[0]!.index).toEqual({ byteStart: 6, byteEnd: 27 });
  });

  it('drops an unresolvable mention and returns nothing for plain text', async () => {
    expect(await detectFacets('обычный текст', async () => null)).toEqual([]);
    expect(await detectFacets('привет @ghost.bsky.social', async () => null)).toEqual([]);
  });
});
