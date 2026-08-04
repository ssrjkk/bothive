import { TwitterApi } from 'twitter-api-v2';
import { BaseWorker } from '../base-worker.js';

export class TwitterWorker extends BaseWorker {
  readonly platformName = 'twitter';
  private instances: Map<string, TwitterApi> = new Map();
  private streams: Map<string, NodeJS.Timeout> = new Map();
  private seenFollowers: Map<string, Set<string>> = new Map();
  private seenTweets: Map<string, Set<string>> = new Map();

  constructor(redisUrl: string) {
    super('twitter-queue', redisUrl, 10);
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    const appKey = credentials.clientId as string;
    const appSecret = credentials.clientSecret as string;
    const accessToken = (credentials.accessToken as string) ?? (credentials.token as string);
    const accessSecret = (credentials.accessSecret as string) ?? (credentials.apiKey as string) ?? (credentials.refreshToken as string);
    const botId = credentials.botId as string;

    if (!appKey || !appSecret || !botId) throw new Error('Missing Twitter credentials');

    this.prepareConnect(botId);

    try {
      let client: TwitterApi;

      if (accessToken && accessSecret) {
        client = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
      } else {
        client = new TwitterApi({ appKey, appSecret });
      }

      this.instances.set(botId, client);

      const entry = this.bots.get(botId);
      if (entry) entry.instance = client;

      if (accessToken) {
        const pollInterval = setInterval(async () => {
          try {
            const me = await client.v2.me();
            const paginator = await client.v2.search(`@${me.data.username}`, {
              'tweet.fields': ['created_at', 'author_id', 'conversation_id'],
              'max_results': 10,
            });

            let seen = this.seenTweets.get(botId);
            const firstRun = !seen;
            if (!seen) {
              seen = new Set<string>();
              this.seenTweets.set(botId, seen);
            }

            let pages = 0;
            for await (const tweet of paginator) {
              if (++pages > 30) break;
              if (tweet.id && seen.has(tweet.id)) continue;
              if (tweet.id) {
                seen.add(tweet.id);
                if (seen.size > 500) {
                  const oldest = seen.values().next().value as string | undefined;
                  if (oldest) seen.delete(oldest);
                }
              }
              if (firstRun) continue;

              await this.emit({
                botId,
                platform: 'twitter',
                type: 'message',
                payload: {
                  text: tweet.text,
                  tweetId: tweet.id,
                  authorId: tweet.author_id,
                  conversationId: tweet.conversation_id,
                },
                timestamp: new Date(),
              });
            }

            await this.pollFollowers(botId, client, me.data.id);
          } catch (err) {
            console.error(`[Twitter] Polling error for ${botId}:`, err);
          }
        }, 60000);

        this.streams.set(botId, pollInterval);
      }

      await this.markConnected(botId);

    } catch (err) {
      await this.markDisconnected(botId, `Connect failed: ${err}`);
      await this.scheduleReconnect(botId, credentials);
      throw err;
    }
  }

  private async pollFollowers(botId: string, client: TwitterApi, userId: string): Promise<void> {
    const followers = await client.v2.followers(userId, { asPaginator: true, max_results: 100 });

    let seen = this.seenFollowers.get(botId);
    const firstRun = !seen;
    if (!seen) {
      seen = new Set<string>();
      this.seenFollowers.set(botId, seen);
    }

    for await (const user of followers) {
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      if (seen.size > 500) {
        const oldest = seen.values().next().value as string | undefined;
        if (oldest) seen.delete(oldest);
      }
      if (!firstRun) {
        await this.emit({
          botId,
          platform: 'twitter',
          type: 'follow',
          payload: { userId: user.id, username: user.username, name: user.name },
          timestamp: new Date(),
        });
      }
    }
  }

  async disconnect(botId: string): Promise<void> {
    const timer = this.streams.get(botId);
    if (timer) {
      clearInterval(timer);
      this.streams.delete(botId);
    }

    const reconnectTimer = this.reconnectTimers.get(botId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(botId);
    }

    this.instances.delete(botId);
    this.bots.delete(botId);
    this.seenFollowers.delete(botId);
    this.seenTweets.delete(botId);
    await this.markDisconnected(botId);
  }

  async executeAction(botId: string, action: { type: string; payload: Record<string, unknown> }): Promise<unknown> {
    const client = this.instances.get(botId);
    if (!client) throw new Error(`Bot ${botId} not connected`);

    switch (action.type) {
      case 'tweet':
        return client.v2.tweet(action.payload.text as string);
      case 'reply':
        return client.v2.reply(action.payload.text as string, action.payload.tweetId as string);
      case 'like':
        return client.v2.like(action.payload.userId as string, action.payload.tweetId as string);
      case 'retweet':
        return client.v2.retweet(action.payload.userId as string, action.payload.tweetId as string);
      case 'follow':
        return client.v2.follow(action.payload.userId as string, action.payload.targetUserId as string);
      case 'unfollow':
        return client.v2.unfollow(action.payload.userId as string, action.payload.targetUserId as string);
      case 'search':
        return client.v2.search(action.payload.query as string, { max_results: action.payload.maxResults as number ?? 10 });
      case 'react':
        if (action.payload.userId === undefined || action.payload.messageId === undefined) {
          throw new Error('react requires userId and messageId (tweet id)');
        }
        return client.v2.like(action.payload.userId as string, action.payload.messageId as string);
      default:
        throw new Error(`Unknown action: ${action.type}`);
    }
  }

  getStatus(botId: string): string {
    return this.instances.has(botId) ? 'running' : 'idle';
  }

  isConnected(botId: string): boolean {
    return this.instances.has(botId);
  }
}
