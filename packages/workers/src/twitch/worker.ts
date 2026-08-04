import tmi from 'tmi.js';
import { ApiClient } from '@twurple/api';
import { AppTokenAuthProvider } from '@twurple/auth';
import { BaseWorker } from '../base-worker.js';

interface TwitchConnection {
  client: tmi.Client;
  channel: string;
}

export class TwitchWorker extends BaseWorker {
  readonly platformName = 'twitch';
  private instances: Map<string, TwitchConnection> = new Map();
  private followTimers: Map<string, NodeJS.Timeout> = new Map();
  private seenFollowers: Map<string, Set<string>> = new Map();

  constructor(redisUrl: string) {
    super('twitch-queue', redisUrl, 15);
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    const username = credentials.username as string;
    const oauth = credentials.token as string;
    const channel = credentials.channel as string;
    const botId = credentials.botId as string;
    if (!username || !oauth || !channel || !botId) throw new Error('Missing Twitch credentials');

    const oldConn = this.instances.get(botId);
    if (oldConn) {
      try { await oldConn.client.disconnect(); } catch { /* ignore */ }
      this.instances.delete(botId);
    }

    this.prepareConnect(botId);

    try {
      const client = new tmi.Client({
        options: { debug: false },
        connection: { reconnect: false, secure: true },
        identity: { username, password: oauth },
        channels: [channel],
      });

      client.on('message', (_channel, userstate, message, _self) => {
        if (_self) return;
        if (userstate.username && username && userstate.username.toLowerCase() === username.toLowerCase()) return;

        const bits = Number(userstate.bits ?? 0);
        if (bits > 0) {
          this.emit({
            botId,
            platform: 'twitch',
            type: 'donation',
            payload: {
              message,
              username: userstate.username,
              bits,
              amount: bits / 100,
              user: userstate,
            },
            timestamp: new Date(),
          });
          return;
        }
        this.emit({
          botId,
          platform: 'twitch',
          type: 'message',
          payload: { message, user: userstate, channel: _channel, username: userstate.username },
          timestamp: new Date(),
        });
      });

      client.on('subscription', (_channel, username, method, message, userstate) => {
        this.emit({
          botId,
          platform: 'twitch',
          type: 'subscribe',
          payload: { username, method, message, user: userstate },
          timestamp: new Date(),
        });
      });

      client.on('resub', (_channel, username, months, message, userstate, methods) => {
        this.emit({
          botId,
          platform: 'twitch',
          type: 'subscribe',
          payload: { username, months, resub: true, message, user: userstate, methods },
          timestamp: new Date(),
        });
      });

      client.on('subgift', (_channel, username, streakMonths, recipient, methods, userstate) => {
        this.emit({
          botId,
          platform: 'twitch',
          type: 'subscribe',
          payload: { username, recipient, streakMonths, gift: true, user: userstate, methods },
          timestamp: new Date(),
        });
      });

      client.on('raided', (_channel, username, viewers) => {
        this.emit({
          botId,
          platform: 'twitch',
          type: 'raid',
          payload: { username, viewers },
          timestamp: new Date(),
        });
      });

      client.on('hosted', (_channel, username, viewers, autohost) => {
        this.emit({
          botId,
          platform: 'twitch',
          type: 'host',
          payload: { username, viewers, autohost },
          timestamp: new Date(),
        });
      });

      client.on('connected', () => {
        console.log(`[Twitch] Bot ${botId} connected to ${channel}`);
      });

      client.on('disconnected', async (reason) => {
        console.log(`[Twitch] Bot ${botId} disconnected: ${reason}`);
        await this.markReconnecting(botId);
        await this.writeLog(botId, 'warn', `Disconnected: ${reason ?? 'unknown reason'}`);
        await this.scheduleReconnect(botId, credentials);
      });

      await client.connect();
      this.instances.set(botId, { client, channel });
      this.startFollowPolling(botId, credentials);
      await this.markConnected(botId);

    } catch (err) {
      await this.markDisconnected(botId, `Connect failed: ${err}`);
      await this.scheduleReconnect(botId, credentials);
      throw err;
    }
  }

  private startFollowPolling(botId: string, credentials: Record<string, unknown>): void {
    const clientId = credentials.clientId as string;
    const clientSecret = credentials.clientSecret as string;
    const channelId = credentials.channelId as string;
    const channelName = credentials.channel as string;
    if (!clientId || !clientSecret) return;

    const authProvider = new AppTokenAuthProvider(clientId, clientSecret);
    const api = new ApiClient({ authProvider });
    let warned = false;

    const poll = async () => {
      try {
        const channel = channelId
          ? await api.users.getUserById(channelId)
          : channelName
            ? await api.users.getUserByName(channelName)
            : null;
        if (!channel) return;

        const result = await api.channels.getChannelFollowers(channel.id, undefined, { limit: 100 });
        const seen = this.seenFollowers.get(botId) ?? new Set<string>();
        const firstRun = seen.size === 0;

        for (const follow of result.data) {
          if (seen.has(follow.userId)) continue;
          seen.add(follow.userId);
          if (seen.size > 500) {
            const oldest = seen.values().next().value as string | undefined;
            if (oldest) seen.delete(oldest);
          }
          if (!firstRun) {
            await this.emit({
              botId,
              platform: 'twitch',
              type: 'follow',
              payload: {
                userId: follow.userId,
                username: follow.userName,
                displayName: follow.userDisplayName,
              },
              timestamp: new Date(),
            });
          }
        }
        this.seenFollowers.set(botId, seen);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 401) {
          if (!warned) {
            warned = true;
            console.warn(`[Twitch] Follow polling disabled for ${botId}: access token lacks moderator:read:followers scope`);
            void this.writeLog(botId, 'warn', 'Follow polling disabled: access token lacks moderator:read:followers scope');
          }
          const timer = this.followTimers.get(botId);
          if (timer) {
            clearInterval(timer);
            this.followTimers.delete(botId);
          }
          return;
        }
        console.error(`[Twitch] Follow polling error for ${botId}:`, err);
      }
    };

    void poll();
    const timer = setInterval(poll, 60000);
    this.followTimers.set(botId, timer);
  }

  async disconnect(botId: string): Promise<void> {
    const timer = this.reconnectTimers.get(botId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(botId);
    }

    const followTimer = this.followTimers.get(botId);
    if (followTimer) {
      clearInterval(followTimer);
      this.followTimers.delete(botId);
    }
    this.seenFollowers.delete(botId);

    const conn = this.instances.get(botId);
    if (conn) {
      try { await conn.client.disconnect(); } catch {}
      this.instances.delete(botId);
    }
    this.bots.delete(botId);
    await this.markDisconnected(botId);
  }

  async executeAction(botId: string, action: { type: string; payload: Record<string, unknown> }): Promise<unknown> {
    const conn = this.instances.get(botId);
    if (!conn) throw new Error(`Bot ${botId} not connected`);

    switch (action.type) {
      case 'say':
        return conn.client.say(action.payload.channel as string, action.payload.message as string);
      case 'timeout':
        return conn.client.timeout(
          action.payload.channel as string,
          action.payload.username as string,
          action.payload.seconds as number,
          action.payload.reason as string,
        );
      case 'ban':
        return conn.client.ban(action.payload.channel as string, action.payload.username as string, action.payload.reason as string);
      case 'unban':
        return conn.client.unban(action.payload.channel as string, action.payload.username as string);
      case 'slow':
        return conn.client.slow(action.payload.channel as string, action.payload.seconds as number);
      case 'followersOnly':
        return conn.client.followersonly(action.payload.channel as string, action.payload.minutes as number);
      case 'emoteOnly':
        return conn.client.emoteonly(action.payload.channel as string);
      case 'subscribersOnly':
        return conn.client.subscribers(action.payload.channel as string);
      case 'react':
        throw new Error('Reactions are not supported on Twitch');
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
