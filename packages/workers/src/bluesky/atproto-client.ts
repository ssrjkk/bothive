/**
 * Минимальный клиент AT Protocol для адаптера Bluesky.
 *
 * SDK @atproto/api тянул zod 3.x, у которого нет закрытой версии в той же мажорной
 * линии (GHSA-mrhx-c7xc-m3w5 чинится только zod 4.6.6). Вместо того чтобы держать
 * в проде непропатченную транзитивную зависимость, здесь голый XRPC поверх fetch:
 * сессия с обновлением по 401, создание/удаление записей, лента уведомлений и
 * детект фасетов (ссылки, упоминания, хештеги) с побайтовыми индексами.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const LINK_RE = /https?:\/\/[^\s]+/g;
const MENTION_RE = /(?:^|\s)@([\w.-]+\.[A-Za-z]{2,})/g;
const HASHTAG_RE = /(?:^|\s)#([^\s#]{1,64})/g;
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

export interface BlueskySession {
  service: string;
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

export interface FacetFeature {
  $type: string;
  [key: string]: unknown;
}

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: FacetFeature[];
}

export interface NotificationRecord {
  uri: string;
  cid: string;
  reason: string;
  reasonSubject?: string;
  isRead: boolean;
  indexedAt: string;
  record: Record<string, unknown>;
  author: { did: string; handle: string; displayName?: string; avatar?: string };
}

export interface NotificationPage {
  notifications: NotificationRecord[];
  cursor?: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

class AtpError extends Error {
  readonly status: number;
  readonly errorName: string;

  constructor(status: number, errorName: string, message: string) {
    super(message);
    this.name = 'AtpError';
    this.status = status;
    this.errorName = errorName;
  }
}

function utf8ByteLength(prefix: string): number {
  return new TextEncoder().encode(prefix).length;
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AtpError(response.status, 'InvalidResponse', 'AT Protocol вернул не JSON');
  }
}

/**
 * Фасеты для текста поста: индексы считаются в байтах UTF-8, как требует
 * app.bsky.richtext.facet, а не в UTF-16, как их даёт String.prototype.indexOf.
 */
export async function detectFacets(
  text: string,
  resolveHandle: (handle: string) => Promise<string | null>,
): Promise<Facet[]> {
  const facets: Facet[] = [];

  for (const match of text.matchAll(LINK_RE)) {
    const raw = match[0];
    const trimmed = raw.replace(TRAILING_PUNCTUATION, '');
    if (!trimmed) continue;
    const start = utf8ByteLength(text.slice(0, match.index ?? 0));
    facets.push({
      index: { byteStart: start, byteEnd: start + utf8ByteLength(trimmed) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: trimmed }],
    });
  }

  for (const match of text.matchAll(MENTION_RE)) {
    const handle = match[1];
    const did = await resolveHandle(handle);
    if (!did) continue;
    // match.index стоит на пробеле перед «@», поэтому +1 = байт самого «@».
    const start = utf8ByteLength(text.slice(0, (match.index ?? 0) + 1));
    facets.push({
      index: { byteStart: start, byteEnd: start + utf8ByteLength(`@${handle}`) },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
    });
  }

  for (const match of text.matchAll(HASHTAG_RE)) {
    const tag = match[1];
    const start = utf8ByteLength(text.slice(0, (match.index ?? 0) + 1));
    facets.push({
      index: { byteStart: start, byteEnd: start + utf8ByteLength(`#${tag}`) },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
    });
  }

  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

export class AtpClient {
  private constructor(
    private session: BlueskySession,
    private fetchImpl: FetchLike,
    private timeoutMs: number,
  ) {}

  get did(): string {
    return this.session.did;
  }

  get handle(): string {
    return this.session.handle;
  }

  static async login(
    input: { service: string; identifier: string; password: string },
    fetchImpl: FetchLike = (url, init) => globalThis.fetch(url, init),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<AtpClient> {
    const service = input.service.replace(/\/+$/, '');
    const response = await fetchImpl(`${service}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: input.identifier, password: input.password }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const body = await readBody(response).catch((): Record<string, unknown> => ({}));
      throw new AtpError(
        response.status,
        String(body.error ?? 'AuthFailed'),
        `Bluesky отклонил вход: ${String(body.error ?? response.status)}`,
      );
    }
    const body = await readBody(response);
    return new AtpClient(
      {
        service,
        accessJwt: String(body.accessJwt ?? ''),
        refreshJwt: String(body.refreshJwt ?? ''),
        did: String(body.did ?? ''),
        handle: String(body.handle ?? ''),
      },
      fetchImpl,
      timeoutMs,
    );
  }

  private async request(
    method: 'GET' | 'POST',
    xrpc: string,
    options: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
    allowRefresh = true,
  ): Promise<Record<string, unknown>> {
    const url = new URL(`/xrpc/${xrpc}`, this.session.service);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.session.accessJwt}`,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (response.status === 401 && allowRefresh) {
      await this.refresh();
      return this.request(method, xrpc, options, false);
    }

    const body = await readBody(response);
    if (!response.ok) {
      throw new AtpError(
        response.status,
        String(body.error ?? 'RequestFailed'),
        `${xrpc}: ${String(body.error ?? response.status)}`,
      );
    }
    return body;
  }

  /**
   * Access-токен живёт час; longevity-бот должен переживать это без перелогина.
   */
  private async refresh(): Promise<void> {
    const response = await this.fetchImpl(
      `${this.session.service}/xrpc/com.atproto.server.refreshSession`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.session.refreshJwt}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) {
      const body = await readBody(response).catch((): Record<string, unknown> => ({}));
      throw new AtpError(
        response.status,
        String(body.error ?? 'RefreshFailed'),
        'Bluesky-сессия истекла, нужен повторный вход',
      );
    }
    const body = await readBody(response);
    this.session = {
      ...this.session,
      accessJwt: String(body.accessJwt ?? ''),
      refreshJwt: String(body.refreshJwt ?? this.session.refreshJwt),
    };
  }

  async resolveHandle(handle: string): Promise<string | null> {
    try {
      const body = await this.request('GET', 'com.atproto.identity.resolveHandle', {
        query: { handle },
      });
      return typeof body.did === 'string' ? body.did : null;
    } catch {
      return null;
    }
  }

  private createRecord(collection: string, record: Record<string, unknown>) {
    return this.request('POST', 'com.atproto.repo.createRecord', {
      body: { repo: this.session.did, collection, record },
    });
  }

  async post(input: {
    text: string;
    facets?: Facet[];
    reply?: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } };
  }): Promise<{ uri: string; cid: string }> {
    const body = await this.createRecord('app.bsky.feed.post', {
      $type: 'app.bsky.feed.post',
      text: input.text,
      ...(input.facets?.length ? { facets: input.facets } : {}),
      ...(input.reply ? { reply: input.reply } : {}),
      createdAt: new Date().toISOString(),
    });
    return { uri: String(body.uri ?? ''), cid: String(body.cid ?? '') };
  }

  async like(uri: string, cid: string): Promise<{ uri: string; cid: string }> {
    const body = await this.createRecord('app.bsky.feed.like', {
      $type: 'app.bsky.feed.like',
      subject: { uri, cid },
      createdAt: new Date().toISOString(),
    });
    return { uri: String(body.uri ?? ''), cid: String(body.cid ?? '') };
  }

  async repost(uri: string, cid: string): Promise<{ uri: string; cid: string }> {
    const body = await this.createRecord('app.bsky.feed.repost', {
      $type: 'app.bsky.feed.repost',
      subject: { uri, cid },
      createdAt: new Date().toISOString(),
    });
    return { uri: String(body.uri ?? ''), cid: String(body.cid ?? '') };
  }

  async follow(did: string): Promise<{ uri: string; cid: string }> {
    const body = await this.createRecord('app.bsky.graph.follow', {
      $type: 'app.bsky.graph.follow',
      subject: did,
      createdAt: new Date().toISOString(),
    });
    return { uri: String(body.uri ?? ''), cid: String(body.cid ?? '') };
  }

  /**
   * at://<did>/<collection>/<rkey> — удаляем именно записанную запись.
   */
  async deleteRecord(uri: string): Promise<void> {
    const parsed = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
    if (!parsed) throw new AtpError(400, 'InvalidUri', `Некорректный AT-URI: ${uri}`);
    const [, repo, collection, rkey] = parsed;
    await this.request('POST', 'com.atproto.repo.deleteRecord', {
      body: { repo, collection, rkey },
    });
  }

  async listNotifications(input: { limit: number; cursor?: string }): Promise<NotificationPage> {
    const body = await this.request('GET', 'app.bsky.notification.listNotifications', {
      query: { limit: input.limit, cursor: input.cursor },
    });
    return {
      notifications: Array.isArray(body.notifications)
        ? (body.notifications as NotificationRecord[])
        : [],
      cursor: typeof body.cursor === 'string' ? body.cursor : undefined,
    };
  }
}

export { AtpError };
