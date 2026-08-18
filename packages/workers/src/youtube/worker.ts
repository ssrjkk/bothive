import { google, youtube_v3 } from 'googleapis';
import { BaseWorker } from '../base-worker.js';

export class YoutubeWorker extends BaseWorker {
  readonly platformName = 'youtube';
  private instances: Map<string, youtube_v3.Youtube> = new Map();
  private pollingTimers: Map<string, NodeJS.Timeout> = new Map();
  private seenComments: Map<string, Set<string>> = new Map();
  private pollInFlight: Set<string> = new Set();
  private lastPollErrorLog: Map<string, number> = new Map();
  private readonly dedupBound = 5000;
  private readonly pollErrorLogThrottleMs = 5 * 60 * 1000;

  constructor(redisUrl: string) {
    super('youtube-queue', redisUrl, 10);
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    const apiKey = credentials.apiKey as string;
    const refreshToken = credentials.refreshToken as string;
    const clientId = credentials.clientId as string;
    const clientSecret = credentials.clientSecret as string;
    const channelId = credentials.channelId as string;
    const botId = credentials.botId as string;
    if (!apiKey && !refreshToken) throw new Error('Missing YouTube credentials');
    if (!botId) throw new Error('Missing botId');

    this.prepareConnect(botId);

    try {
      let youtube: youtube_v3.Youtube;
      if (refreshToken && clientId && clientSecret) {
        // OAuth2 client allows posting comments/replies (an API key is read-only).
        // googleapis refreshes the access token from the refresh token automatically.
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        youtube = google.youtube({ version: 'v3', auth: oauth2Client });
      } else {
        youtube = google.youtube({ version: 'v3', auth: apiKey });
      }
      this.instances.set(botId, youtube);

      const entry = this.bots.get(botId);
      if (entry) entry.instance = youtube;

      if (channelId) {
        // A previous connection may still own a poll timer for this bot (e.g.
        // a failed reconnect left the old interval running); clear it before
        // registering a new one so reconnects never stack intervals.
        const previous = this.pollingTimers.get(botId);
        if (previous) {
          clearInterval(previous);
          this.pollingTimers.delete(botId);
        }
        const timer = setInterval(async () => {
          // A slow tick must not overlap the next one (each tick can await
          // script handlers on the emitted events); otherwise concurrent polls
          // would duplicate comment processing against the API.
          if (this.pollInFlight.has(botId)) return;
          this.pollInFlight.add(botId);
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

            const BOUND = this.dedupBound;
            for (const item of res.data.items ?? []) {
              if (!this.instances.has(botId)) break;
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
            const message = (err as Error)?.message ?? String(err);
            // Don't let a dead quota/token be a silent zombie: surface it in the
            // bot's persisted log, throttled so a permanently failing poll does
            // not spam the log on every 30s tick.
            console.error(`[YouTube] Polling error for ${botId}:`, err);
            const now = Date.now();
            if (now - (this.lastPollErrorLog.get(botId) ?? 0) >= this.pollErrorLogThrottleMs) {
              this.lastPollErrorLog.set(botId, now);
              void this.writeLog(botId, 'error', `YouTube polling error: ${message}`);
            }
          } finally {
            this.pollInFlight.delete(botId);
          }
        }, 30000);

        this.pollingTimers.set(botId, timer);
      }

      await this.markConnected(botId);
    } catch (err) {
      await this.markDisconnected(botId, `Connect failed: ${err}`);
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
    this.pollInFlight.delete(botId);
    this.lastPollErrorLog.delete(botId);
    await this.markDisconnected(botId);
  }

  async executeAction(
    botId: string,
    action: { type: string; payload: Record<string, unknown> },
  ): Promise<unknown> {
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
          maxResults: (action.payload.maxResults as number) ?? 20,
        });
      case 'react':
        throw new Error('Reactions are not supported on YouTube');
      default:
        throw new Error(`Unknown action: ${action.type}`);
    }
  }

  protected hasLiveConnection(botId: string): boolean {
    return this.instances.has(botId);
  }
}
