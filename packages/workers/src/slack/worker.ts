import { App, LogLevel } from '@slack/bolt';
import { BaseWorker } from '../base-worker.js';

/**
 * Slack adapter. Uses Bolt SDK for event subscriptions and message actions.
 * Supports both Socket Mode (websocket, recommended for dev/firewalls) and
 * HTTP webhook mode (production with public endpoint).
 */
export class SlackWorker extends BaseWorker {
  readonly platformName = 'slack';
  private instances: Map<string, App> = new Map();

  constructor(redisUrl: string) {
    super('slack-queue', redisUrl, 20);
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    const botToken = credentials.token as string;
    const botId = credentials.botId as string;
    const appToken = credentials.appToken as string | undefined;
    const signingSecret = credentials.signingSecret as string | undefined;

    if (!botToken || !botId) throw new Error('Missing token or botId');

    const oldApp = this.instances.get(botId);
    if (oldApp) {
      try {
        await oldApp.stop();
      } catch {
        /* ignore */
      }
      this.instances.delete(botId);
    }

    this.prepareConnect(botId);

    try {
      const app = new App({
        token: botToken,
        appToken,
        signingSecret,
        logLevel: LogLevel.WARN,
        socketMode: !!appToken,
      });

      app.event('message', async ({ event, client }) => {
        if ('bot_id' in event && event.bot_id) return;

        const text = 'text' in event ? (event.text as string) : '';
        const user = 'user' in event ? (event.user as string) : '';

        let userInfo: { id: string; name: string } | undefined;
        if (user) {
          try {
            const result = await client.users.info({ user });
            userInfo = { id: user, name: result.user?.name ?? user };
          } catch {
            userInfo = { id: user, name: user };
          }
        } else {
          userInfo = { id: 'unknown', name: 'unknown' };
        }

        await this.emit({
          botId,
          platform: 'slack',
          type: 'message',
          payload: {
            text,
            from: userInfo,
            channel: event.channel,
            channelId: event.channel,
            messageId: event.ts,
            threadTs: 'thread_ts' in event ? event.thread_ts : undefined,
            subtype: 'subtype' in event ? event.subtype : undefined,
          },
          timestamp: new Date(),
        });
      });

      app.event('reaction_added', async ({ event }) => {
        const authResult = await app.client.auth.test();
        if (event.user === authResult.user_id) return;

        await this.emit({
          botId,
          platform: 'slack',
          type: 'reaction',
          payload: {
            emoji: event.reaction,
            messageId: event.item.ts,
            channelId: event.item.channel,
            userId: event.user,
          },
          timestamp: new Date(),
        });
      });

      app.event('member_joined_channel', async ({ event }) => {
        await this.emit({
          botId,
          platform: 'slack',
          type: 'member_join',
          payload: {
            userId: event.user,
            channelId: event.channel,
          },
          timestamp: new Date(),
        });
      });

      app.event('team_join', async ({ event }) => {
        await this.emit({
          botId,
          platform: 'slack',
          type: 'team_join',
          payload: {
            userId: event.user.id,
            username: event.user.name,
            realName: event.user.real_name,
          },
          timestamp: new Date(),
        });
      });

      await app.start();
      this.instances.set(botId, app);

      this.markConnected(botId);
      console.log(`[info] ${botId}: Slack bot connected`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[error] ${botId}: Slack connect failed: ${message}`);
      throw err;
    }
  }

  async disconnect(botId: string): Promise<void> {
    const app = this.instances.get(botId);
    if (app) {
      try {
        await app.stop();
      } catch {
        /* ignore */
      }
      this.instances.delete(botId);
    }
    await this.markDisconnected(botId);
  }

  async executeAction(
    botId: string,
    action: { type: string; payload: Record<string, unknown> },
  ): Promise<unknown> {
    await this.assertOutboundAllowed(botId, action.type);
    const app = this.instances.get(botId);
    if (!app) throw new Error(`Slack bot ${botId} not connected`);

    switch (action.type) {
      case 'sendMessage': {
        const channel = action.payload.channel as string;
        const text = action.payload.text as string;
        if (!channel || !text) throw new Error('Missing channel or text');

        const result = await app.client.chat.postMessage({ channel, text });
        return { messageId: result.ts, channel: result.channel };
      }

      case 'updateMessage': {
        const channel = action.payload.channel as string;
        const ts = action.payload.ts as string;
        const text = action.payload.text as string;
        if (!channel || !ts || !text) throw new Error('Missing channel, ts, or text');

        await app.client.chat.update({ channel, ts, text });
        return { updated: true };
      }

      case 'deleteMessage': {
        const channel = action.payload.channel as string;
        const ts = action.payload.ts as string;
        if (!channel || !ts) throw new Error('Missing channel or ts');

        await app.client.chat.delete({ channel, ts });
        return { deleted: true };
      }

      case 'addReaction': {
        const channel = action.payload.channel as string;
        const timestamp = action.payload.timestamp as string;
        const name = action.payload.name as string;
        if (!channel || !timestamp || !name) {
          throw new Error('Missing channel, timestamp, or name');
        }

        await app.client.reactions.add({ channel, timestamp, name });
        return { reacted: true };
      }

      case 'openModal': {
        const triggerId = action.payload.triggerId as string;
        const view = action.payload.view as Record<string, unknown>;
        if (!triggerId || !view) throw new Error('Missing triggerId or view');

        await app.client.views.open({
          trigger_id: triggerId,
          view: view as any,
        });
        return { opened: true };
      }

      default:
        throw new Error(`Unknown Slack action: ${action.type}`);
    }
  }

  protected hasLiveConnection(botId: string): boolean {
    return this.instances.has(botId);
  }
}
