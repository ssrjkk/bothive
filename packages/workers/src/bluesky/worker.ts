import { BskyAgent, RichText } from '@atproto/api';
import { BaseWorker } from '../base-worker.js';

/**
 * Bluesky adapter. Uses the AT Protocol (atproto) SDK. Bluesky is a
 * decentralized social network built on the same protocol that powers AT
 * Protocol — posts, likes, reposts, and follows are all first-class citizens.
 *
 * Bluesky does not have a real-time websocket gateway like Discord/Slack.
 * Instead, we poll the notification feed on an interval and emit events for
 * new mentions, replies, likes, and follows. This is similar to how the
 * Twitter adapter worked before streaming API access.
 */
export class BlueskyWorker extends BaseWorker {
  readonly platformName = 'bluesky';
  private agents: Map<string, BskyAgent> = new Map();
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

    const oldAgent = this.agents.get(botId);
    if (oldAgent) {
      this.stopPolling(botId);
      this.agents.delete(botId);
    }

    this.prepareConnect(botId);

    try {
      const agent = new BskyAgent({ service });
      await agent.login({ identifier, password });

      this.agents.set(botId, agent);
      this.markConnected(botId);
      console.log(`[info] ${botId}: Bluesky bot connected as @${identifier}`);

      this.startPolling(botId, agent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[error] ${botId}: Bluesky connect failed: ${message}`);
      throw err;
    }
  }

  private startPolling(botId: string, agent: BskyAgent): void {
    const intervalMs = 30_000;

    const poll = async () => {
      try {
        const cursor = this.lastSeenCursors.get(botId);
        const response = await agent.listNotifications({
          limit: 50,
          cursor,
        });

        for (const notif of response.data.notifications) {
          await this.emit({
            botId,
            platform: 'bluesky',
            type: this.mapNotificationType(notif.reason),
            payload: {
              uri: notif.uri,
              cid: notif.cid,
              author: {
                did: notif.author.did,
                handle: notif.author.handle,
                displayName: notif.author.displayName,
                avatar: notif.author.avatar,
              },
              reason: notif.reason,
              reasonSubject: notif.reasonSubject,
              record: notif.record,
              isRead: notif.isRead,
              indexedAt: notif.indexedAt,
            },
            timestamp: new Date(notif.indexedAt),
          });
        }

        if (response.data.cursor) {
          this.lastSeenCursors.set(botId, response.data.cursor);
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
    this.agents.delete(botId);
    await this.markDisconnected(botId);
  }

  async executeAction(
    botId: string,
    action: { type: string; payload: Record<string, unknown> },
  ): Promise<unknown> {
    await this.assertOutboundAllowed(botId, action.type);
    const agent = this.agents.get(botId);
    if (!agent) throw new Error(`Bluesky bot ${botId} not connected`);

    switch (action.type) {
      case 'post': {
        const text = action.payload.text as string;
        if (!text) throw new Error('Missing text');

        const rt = new RichText({ text });
        await rt.detectFacets(agent);

        const response = await agent.post({
          text: rt.text,
          facets: rt.facets,
          createdAt: new Date().toISOString(),
        });

        return { uri: response.uri, cid: response.cid };
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

        const rt = new RichText({ text });
        await rt.detectFacets(agent);

        const response = await agent.post({
          text: rt.text,
          facets: rt.facets,
          reply: {
            root: { uri: rootUri, cid: rootCid },
            parent: { uri: parentUri, cid: parentCid },
          },
          createdAt: new Date().toISOString(),
        });

        return { uri: response.uri, cid: response.cid };
      }

      case 'like': {
        const uri = action.payload.uri as string;
        const cid = action.payload.cid as string;
        if (!uri || !cid) throw new Error('Missing uri or cid');

        const response = await agent.like(uri, cid);
        return { uri: response.uri, cid: response.cid };
      }

      case 'repost': {
        const uri = action.payload.uri as string;
        const cid = action.payload.cid as string;
        if (!uri || !cid) throw new Error('Missing uri or cid');

        const response = await agent.repost(uri, cid);
        return { uri: response.uri, cid: response.cid };
      }

      case 'follow': {
        const did = action.payload.did as string;
        if (!did) throw new Error('Missing did');

        const response = await agent.follow(did);
        return { uri: response.uri, cid: response.cid };
      }

      case 'deletePost': {
        const uri = action.payload.uri as string;
        if (!uri) throw new Error('Missing uri');

        await agent.deletePost(uri);
        return { deleted: true };
      }

      default:
        throw new Error(`Unknown Bluesky action: ${action.type}`);
    }
  }

  protected hasLiveConnection(botId: string): boolean {
    return this.agents.has(botId);
  }
}
