import { Client, GatewayIntentBits, Events, Message, Partials } from 'discord.js';
import { BaseWorker } from '../base-worker.js';
import { publishLog } from '../log-publisher.js';

/**
 * Discord adapter. Connects via the gateway (long-lived WebSocket) and emits
 * events for messages, reactions, and member joins. Supports both bot tokens
 * and user tokens (the latter for automation scripts that act on behalf of a
 * user account — use with care, Discord ToS restricts userbot automation).
 */
export class DiscordWorker extends BaseWorker {
  readonly platformName = 'discord';
  private instances: Map<string, Client> = new Map();

  constructor(redisUrl: string) {
    super('discord-queue', redisUrl, 20);
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    const token = credentials.token as string;
    const botId = credentials.botId as string;
    if (!token || !botId) throw new Error('Missing token or botId');

    const oldClient = this.instances.get(botId);
    if (oldClient) {
      try {
        oldClient.destroy();
      } catch {
        /* ignore */
      }
      this.instances.delete(botId);
    }

    this.prepareConnect(botId);

    try {
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.GuildMessageReactions,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Message, Partials.Channel, Partials.Reaction],
      });

      client.once(Events.ClientReady, (readyClient) => {
        this.markConnected(botId);
        publishLog({
          botId,
          level: 'info',
          message: `Discord bot connected as ${readyClient.user.tag}`,
        });
      });

      client.on(Events.MessageCreate, async (message: Message) => {
        if (message.author.bot) return;

        await this.emit({
          botId,
          platform: 'discord',
          type: 'message',
          payload: {
            text: message.content,
            from: {
              id: message.author.id,
              username: message.author.username,
              discriminator: message.author.discriminator,
              bot: message.author.bot,
            },
            channel: {
              id: message.channel.id,
              type: message.channel.type,
              guildId: message.guild?.id,
              name: 'name' in message.channel ? message.channel.name : undefined,
            },
            messageId: message.id,
            guildId: message.guild?.id,
            attachments: message.attachments.map((a) => ({
              id: a.id,
              url: a.url,
              contentType: a.contentType,
              size: a.size,
            })),
          },
          timestamp: new Date(),
        });
      });

      client.on(Events.MessageReactionAdd, async (reaction, user) => {
        if (user.bot) return;

        await this.emit({
          botId,
          platform: 'discord',
          type: 'reaction',
          payload: {
            emoji: reaction.emoji.name ?? reaction.emoji.id,
            messageId: reaction.message.id,
            channelId: reaction.message.channel.id,
            guildId: reaction.message.guild?.id,
            userId: user.id,
            username: user.username,
          },
          timestamp: new Date(),
        });
      });

      client.on(Events.GuildMemberAdd, async (member) => {
        await this.emit({
          botId,
          platform: 'discord',
          type: 'member_join',
          payload: {
            userId: member.id,
            username: member.user.username,
            guildId: member.guild.id,
            guildName: member.guild.name,
            joinedAt: member.joinedAt?.toISOString(),
          },
          timestamp: new Date(),
        });
      });

      client.on('error', (error) => {
        publishLog({
          botId,
          level: 'error',
          message: `Discord client error: ${error.message}`,
        });
      });

      await client.login(token);
      this.instances.set(botId, client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      publishLog({
        botId,
        level: 'error',
        message: `Discord connect failed: ${message}`,
      });
      throw err;
    }
  }

  async disconnect(botId: string): Promise<void> {
    const client = this.instances.get(botId);
    if (client) {
      try {
        client.destroy();
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
    const client = this.instances.get(botId);
    if (!client) throw new Error(`Discord bot ${botId} not connected`);

    switch (action.type) {
      case 'sendMessage': {
        const channelId = action.payload.channelId as string;
        const content = action.payload.content as string;
        if (!channelId || !content) throw new Error('Missing channelId or content');

        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased() || channel.partial) {
          throw new Error(`Channel ${channelId} not found or not text-based`);
        }

        if ('send' in channel && typeof channel.send === 'function') {
          const message = await channel.send(content);
          return { messageId: message.id };
        }
        throw new Error(`Channel ${channelId} does not support sending messages`);
      }

      case 'deleteMessage': {
        const channelId = action.payload.channelId as string;
        const messageId = action.payload.messageId as string;
        if (!channelId || !messageId) throw new Error('Missing channelId or messageId');

        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased() || channel.partial) {
          throw new Error(`Channel ${channelId} not found`);
        }

        if ('messages' in channel) {
          const message = await channel.messages.fetch(messageId);
          await message.delete();
          return { deleted: true };
        }
        throw new Error(`Channel ${channelId} does not support message operations`);
      }

      case 'addReaction': {
        const channelId = action.payload.channelId as string;
        const messageId = action.payload.messageId as string;
        const emoji = action.payload.emoji as string;
        if (!channelId || !messageId || !emoji) {
          throw new Error('Missing channelId, messageId, or emoji');
        }

        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased() || channel.partial) {
          throw new Error(`Channel ${channelId} not found`);
        }

        if ('messages' in channel) {
          const message = await channel.messages.fetch(messageId);
          await message.react(emoji);
          return { reacted: true };
        }
        throw new Error(`Channel ${channelId} does not support message operations`);
      }

      default:
        throw new Error(`Unknown Discord action: ${action.type}`);
    }
  }

  protected hasLiveConnection(botId: string): boolean {
    return this.instances.has(botId);
  }
}
