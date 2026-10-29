import { BaseWorker } from '../base-worker.js';
import { AtpClient, detectFacets, type NotificationRecord } from './atproto-client.js';

/**
 * Bluesky adapter. Говорит с AT Protocol напрямую (XRPC поверх fetch): см.
 * bluesky/atproto-client.ts — SDK тянул транзитивную зависимость без закрытой
 * версии, а держать её в проде из-за пяти методов незачем.
 *
 * У Bluesky нет realtime-шлюза вроде Discord/Slack, поэтому события снимаем
 * опросом ленты уведомлений: упоминания, ответы, лайки, репосты и подписки.
 */
export class BlueskyWorker extends BaseWorker {
  readonly platformName = 'bluesky';
  private clients: Map<string, AtpClient> = new Map();
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastSeenCursors: Map<string, string> = new Map();

  constructor(redisUrl: string) {
    super('bluesky-queue', redisUrl, 20);
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    const identifier = credentials.username as string;
    const password = credentials.token as string;
    const service = (credentials.service as string) || 'https://bsky.social';
    const botId = credentials.botId as string;

    if (!identifier || !password || !botId) {
      throw new Error('Missing username, token (password), or botId');
    }

    if (this.clients.has(botId)) {
      this.stopPolling(botId);
      this.clients.delete(botId);
    }

    this.prepareConnect(botId);

    try {
      const client = await AtpClient.login({ service, identifier, password });

      this.clients.set(botId, client);
      this.markConnected(botId);
      console.log(`[info] ${botId}: Bluesky bot connected as @${identifier}`);

      this.startPolling(botId, client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[error] ${botId}: Bluesky connect failed: ${message}`);
      throw err;
    }
  }

  private client(botId: string): AtpClient {
    const client = this.clients.get(botId);
    if (!client) throw new Error(`Bluesky bot ${botId} not connected`);
    return client;
  }

  private startPolling(botId: string, client: AtpClient): void {
    const intervalMs = 30_000;

    const poll = async () => {
      try {
        const cursor = this.lastSeenCursors.get(botId);
        const page = await client.listNotifications({ limit: 50, cursor });

        for (const notification of page.notifications) {
          await this.emit({
            botId,
            platform: 'bluesky',
            type: this.mapNotificationType(notification.reason),
            payload: this.notificationPayload(notification),
            timestamp: new Date(notification.indexedAt),
          });
        }

        if (page.cursor) {
          this.lastSeenCursors.set(botId, page.cursor);
        }
      } catch (err) {
        console.log(
          `[error] ${botId}: Bluesky poll failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    poll();
    const interval = setInterval(poll, intervalMs);
    this.pollIntervals.set(botId, interval);
  }

  private notificationPayload(notification: NotificationRecord): Record<string, unknown> {
    return {
      uri: notification.uri,
      cid: notification.cid,
      author: {
        did: notification.author.did,
        handle: notification.author.handle,
        displayName: notification.author.displayName,
        avatar: notification.author.avatar,
      },
      reason: notification.reason,
      reasonSubject: notification.reasonSubject,
      record: notification.record,
      isRead: notification.isRead,
      indexedAt: notification.indexedAt,
    };
  }

  private stopPolling(botId: string): void {
    const interval = this.pollIntervals.get(botId);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(botId);
    }
    this.lastSeenCursors.delete(botId);
  }

  private mapNotificationType(reason: string): import('@bothive/core').EventType {
    switch (reason) {
      case 'like':
        return 'like';
      case 'repost':
        return 'repost';
      case 'follow':
        return 'follow';
      case 'reply':
        return 'reply';
      case 'mention':
        return 'mention';
      case 'quote':
        return 'quote';
      default:
        return 'notification';
    }
  }

  async disconnect(botId: string): Promise<void> {
    this.stopPolling(botId);
    this.clients.delete(botId);
    await this.markDisconnected(botId);
  }

  async executeAction(
    botId: string,
    action: { type: string; payload: Record<string, unknown> },
  ): Promise<unknown> {
    await this.assertOutboundAllowed(botId, action.type);
    const client = this.client(botId);

    switch (action.type) {
      case 'post': {
        const text = action.payload.text as string;
        if (!text) throw new Error('Missing text');
        const facets = await detectFacets(text, (handle) => client.resolveHandle(handle));
        return client.post({ text, facets });
      }

      case 'reply': {
        const text = action.payload.text as string;
        const parentUri = action.payload.parentUri as string;
        const parentCid = action.payload.parentCid as string;
        const rootUri = (action.payload.rootUri as string) || parentUri;
        const rootCid = (action.payload.rootCid as string) || parentCid;

        if (!text || !parentUri || !parentCid) {
          throw new Error('Missing text, parentUri, or parentCid');
        }

        const facets = await detectFacets(text, (handle) => client.resolveHandle(handle));
        return client.post({
          text,
          facets,
          reply: {
            root: { uri: rootUri, cid: rootCid },
            parent: { uri: parentUri, cid: parentCid },
          },
        });
      }

      case 'like': {
        const uri = action.payload.uri as string;
        const cid = action.payload.cid as string;
        if (!uri || !cid) throw new Error('Missing uri or cid');
        return client.like(uri, cid);
      }

      case 'repost': {
        const uri = action.payload.uri as string;
        const cid = action.payload.cid as string;
        if (!uri || !cid) throw new Error('Missing uri or cid');
        return client.repost(uri, cid);
      }

      case 'follow': {
        const did = action.payload.did as string;
        if (!did) throw new Error('Missing did');
        return client.follow(did);
      }

      case 'deletePost': {
        const uri = action.payload.uri as string;
        if (!uri) throw new Error('Missing uri');
        await client.deleteRecord(uri);
        return { deleted: true };
      }

      default:
        throw new Error(`Unknown Bluesky action: ${action.type}`);
    }
  }

  protected hasLiveConnection(botId: string): boolean {
    return this.clients.has(botId);
  }
}
