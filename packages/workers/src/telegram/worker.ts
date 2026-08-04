import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { BaseWorker } from '../base-worker.js';

export class TelegramWorker extends BaseWorker {
  readonly platformName = 'telegram';
  private instances: Map<string, Bot> = new Map();

  constructor(redisUrl: string) {
    super('telegram-queue', redisUrl, 20);
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    const token = credentials.token as string;
    const botId = credentials.botId as string;
    if (!token || !botId) throw new Error('Missing token or botId');

    const oldBot = this.instances.get(botId);
    if (oldBot) {
      try { await oldBot.stop(); } catch { /* ignore */ }
      this.instances.delete(botId);
    }

    this.prepareConnect(botId);

    try {
      const bot = new Bot(token);
      bot.api.config.use(autoRetry());

      bot.on('message', async (ctx) => {
        await this.emit({
          botId,
          platform: 'telegram',
          type: 'message',
          payload: {
            text: ctx.message.text,
            from: ctx.from,
            chat: ctx.chat,
            chatId: ctx.chat.id,
            messageId: ctx.message.message_id,
          },
          timestamp: new Date(),
        });
      });

      bot.on('callback_query:data', async (ctx) => {
        await this.emit({
          botId,
          platform: 'telegram',
          type: 'message',
          payload: {
            callbackData: ctx.callbackQuery.data,
            from: ctx.callbackQuery.from,
            chatId: ctx.callbackQuery.message?.chat.id,
            messageId: ctx.callbackQuery.message?.message_id,
          },
          timestamp: new Date(),
        });
      });

      bot.on('my_chat_member', async (ctx) => {
        await this.emit({
          botId,
          platform: 'telegram',
          type: 'message',
          payload: {
            chat: ctx.myChatMember?.chat,
            oldState: ctx.myChatMember?.old_chat_member,
            newState: ctx.myChatMember?.new_chat_member,
          },
          timestamp: new Date(),
        });
      });

      await bot.start({
        drop_pending_updates: true,
        onStart: () => console.log(`[Telegram] Bot ${botId} started`),
      });

      this.instances.set(botId, bot);
      await this.markConnected(botId);

      const entry = this.bots.get(botId);
      if (entry) entry.instance = bot;

    } catch (err) {
      await this.markDisconnected(botId, `Connect failed: ${err}`);
      await this.scheduleReconnect(botId, credentials);
      throw err;
    }
  }

  async disconnect(botId: string): Promise<void> {
    const timer = this.reconnectTimers.get(botId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(botId);
    }

    const bot = this.instances.get(botId);
    if (bot) {
      await bot.stop();
      this.instances.delete(botId);
    }
    this.bots.delete(botId);
    await this.markDisconnected(botId);
  }

  async executeAction(botId: string, action: { type: string; payload: Record<string, unknown> }): Promise<unknown> {
    const bot = this.instances.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not connected`);

    switch (action.type) {
      case 'sendMessage':
        return bot.api.sendMessage(action.payload.chatId as number, action.payload.text as string, {
          parse_mode: action.payload.parseMode as 'HTML' | 'Markdown' | undefined,
        });
      case 'sendPhoto':
        return bot.api.sendPhoto(action.payload.chatId as number, action.payload.photo as string, {
          caption: action.payload.caption as string,
        });
      case 'deleteMessage':
        return bot.api.deleteMessage(action.payload.chatId as number, action.payload.messageId as number);
      case 'sendSticker':
        return bot.api.sendSticker(action.payload.chatId as number, action.payload.sticker as string);
      case 'sendDice':
        return bot.api.sendDice(action.payload.chatId as number, '🎲');
      case 'react':
        if (action.payload.chatId === undefined || action.payload.messageId === undefined) {
          throw new Error('react requires chatId and messageId');
        }
        {
          const emoji = (action.payload.reaction as string) ?? '👍';
          const reactions = [{ type: 'emoji', emoji }] as never;
          return bot.api.setMessageReaction(
            action.payload.chatId as number,
            action.payload.messageId as number,
            reactions,
          );
        }
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
