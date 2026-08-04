import { google, youtube_v3 } from 'googleapis';
import { BaseWorker } from '../base-worker.js';

export class YoutubeWorker extends BaseWorker {
  readonly platformName = 'youtube';
  private instances: Map<string, youtube_v3.Youtube> = new Map();
  private pollingTimers: Map<string, NodeJS.Timeout> = new Map();
  private seenComments: Map<string, Set<string>> = new Map();

  constructor(redisUrl: string) {
    super('youtube-queue', redisUrl, 10);
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    const apiKey = credentials.apiKey as string;
    const channelId = credentials.channelId as string;
    const botId = credentials.botId as string;
    if (!apiKey || !botId) throw new Error('Missing YouTube credentials');

    this.prepareConnect(botId);

    try {
      const youtube = google.youtube({ version: 'v3', auth: apiKey });
      this.instances.set(botId, youtube);

      const entry = this.bots.get(botId);
      if (entry) entry.instance = youtube;

      if (channelId) {
        const timer = setInterval(async () => {
          try {
            const res = await youtube.commentThreads.list({
              part: ['snippet'],
              channelId,
              maxResults: 10,
              order: 'time',
            });

            let seen = this.seenComments.get(botId);
            const firstRun = !seen;
            if (!seen) {
              seen = new Set<string>();
              this.seenComments.set(botId, seen);
            }

            const BOUND = 500;
            for (const item of res.data.items ?? []) {
              const comment = item.snippet?.topLevelComment?.snippet;
              const commentId = item.snippet?.topLevelComment?.id;
              if (!comment || !commentId) continue;
              if (seen.has(commentId)) continue;
              seen.add(commentId);
              if (seen.size > BOUND) {
                const oldest = seen.values().next().value as string | undefined;
                if (oldest) seen.delete(oldest);
              }
              if (firstRun) continue;

              await this.emit({
                botId,
                platform: 'youtube',
                type: 'comment',
                payload: {
                  commentId,
                  text: comment.textDisplay,
                  author: comment.authorDisplayName,
                  videoId: item.snippet?.videoId,
                  channelId,
                },
                timestamp: new Date(),
              });
            }
          } catch (err) {
            console.error(`[YouTube] Polling error for ${botId}:`, err);
          }
        }, 30000);

        this.pollingTimers.set(botId, timer);
      }

      await this.markConnected(botId);

    } catch (err) {
      await this.markDisconnected(botId, `Connect failed: ${err}`);
      await this.scheduleReconnect(botId, credentials);
      throw err;
    }
  }

  async disconnect(botId: string): Promise<void> {
    const timer = this.pollingTimers.get(botId);
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(botId);
    }

    const reconnectTimer = this.reconnectTimers.get(botId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(botId);
    }

    this.instances.delete(botId);
    this.bots.delete(botId);
    this.seenComments.delete(botId);
    await this.markDisconnected(botId);
  }

  async executeAction(botId: string, action: { type: string; payload: Record<string, unknown> }): Promise<unknown> {
    const youtube = this.instances.get(botId);
    if (!youtube) throw new Error(`Bot ${botId} not connected`);

    switch (action.type) {
      case 'replyComment':
        return youtube.comments.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              parentId: action.payload.parentId as string,
              textOriginal: action.payload.text as string,
            },
          },
        });
      case 'setComment':
        return youtube.comments.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              videoId: action.payload.videoId as string,
              textOriginal: action.payload.text as string,
            },
          },
        });
      case 'listComments':
        return youtube.commentThreads.list({
          part: ['snippet'],
          videoId: action.payload.videoId as string,
          maxResults: action.payload.maxResults as number ?? 20,
        });
      case 'react':
        throw new Error('Reactions are not supported on YouTube');
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
