import { Api, Bot } from 'grammy';

type TelegramReaction = Parameters<Api['setMessageReaction']>[2][number];
/** Raw Telegram update as accepted by `bot.handleUpdate` (grammy re-export). */
type TelegramUpdate = Parameters<Bot['handleUpdate']>[0];
import { autoRetry } from '@grammyjs/auto-retry';
import { BaseWorker } from '../base-worker.js';

/**
 * Public base URL of the API (e.g. https://api.bothive.example). Telegram
 * webhook mode builds the webhook URL from it; without it, webhook-mode
 * connects fail fast instead of registering a dead webhook.
 */
const TELEGRAM_WEBHOOK_BASE_URL_ENV = 'TELEGRAM_WEBHOOK_BASE_URL';

export class TelegramWorker extends BaseWorker {
  readonly platformName = 'telegram';
  private instances: Map<string, Bot> = new Map();
  /** Bots connected in webhook mode: their webhook must be removed on disconnect. */
  private webhookModeBots = new Set<string>();

  constructor(redisUrl: string) {
    super('telegram-queue', redisUrl, 20);
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    const token = credentials.token as string;
    const botId = credentials.botId as string;
    const webhookMode = credentials.webhookMode === true;
    if (!token || !botId) throw new Error('Missing token or botId');

    const oldBot = this.instances.get(botId);
    if (oldBot) {
      if (this.webhookModeBots.has(botId)) {
        try {
          await oldBot.api.deleteWebhook();
        } catch {
          /* ignore */
        }
        this.webhookModeBots.delete(botId);
      }
      try {
        await oldBot.stop();
      } catch {
        /* ignore */
      }
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

      if (webhookMode) {
        // Webhook mode: Telegram pushes updates to the API, which enqueues
        // them for this worker (handled by handleUpdate through grammy). No
        // polling loop runs, so there is nothing to await — setWebhook success
        // is the connect point, matching polling mode's `onStart`.
        const base = (process.env[TELEGRAM_WEBHOOK_BASE_URL_ENV] ?? '').replace(/\/+$/, '');
        if (!base) {
          throw new Error(`Webhook mode requires ${TELEGRAM_WEBHOOK_BASE_URL_ENV}`);
        }
        await bot.api.setWebhook(`${base}/api/telegram/webhook/${botId}/${token}`, {
          secret_token: token,
          drop_pending_updates: true,
        });
        this.webhookModeBots.add(botId);
        console.log(`[Telegram] Bot ${botId} webhook registered`);
        this.instances.set(botId, bot);
        await this.markConnected(botId);

        const entry = this.bots.get(botId);
        if (entry) entry.instance = bot;
        return;
      }

      // grammy's `start()` awaits its long-polling loop and only resolves once
      // the bot is stopped, so `await bot.start()` here would hang the connect:
      // the bot would never be marked connected, every reconcile cycle would
      // spawn a duplicate polling loop, and a later disconnect() would make the
      // stale continuation mark a stopped bot as running. "Connected" is
      // signalled by the `onStart` callback, which runs after setup (init +
      // deleteWebhook) — exactly when long polling is live.
      let live = false;
      await new Promise<void>((resolve, reject) => {
        const startPromise = bot.start({
          drop_pending_updates: true,
          onStart: () => {
            live = true;
            console.log(`[Telegram] Bot ${botId} started`);
            resolve();
          },
        });
        startPromise.catch((err) => {
          console.error(`[Telegram] Bot ${botId} polling error:`, err);
          // A rejection after the bot was running (401 revoked token / 409
          // duplicate instance) means the loop died: drop the zombie connection
          // and let the reconnect machinery restore it. Setup failures reject
          // before `onStart` and are surfaced as a connect error below.
          if (live && this.instances.get(botId) === bot) {
            void this.restoreConnection(botId);
          }
          reject(err);
        });
      });

      this.instances.set(botId, bot);
      await this.markConnected(botId);

      const entry = this.bots.get(botId);
      if (entry) entry.instance = bot;
    } catch (err) {
      await this.markDisconnected(botId, `Connect failed: ${err}`);
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
      if (this.webhookModeBots.has(botId)) {
        // Remove the webhook so Telegram stops pushing updates to a dead bot.
        try {
          await bot.api.deleteWebhook();
        } catch {
          /* ignore */
        }
        this.webhookModeBots.delete(botId);
      }
      await bot.stop();
      this.instances.delete(botId);
    }
    this.bots.delete(botId);
    await this.markDisconnected(botId);
  }

  async executeAction(
    botId: string,
    action: { type: string; payload: Record<string, unknown> },
  ): Promise<unknown> {
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
        return bot.api.deleteMessage(
          action.payload.chatId as number,
          action.payload.messageId as number,
        );
      case 'sendSticker':
        return bot.api.sendSticker(
          action.payload.chatId as number,
          action.payload.sticker as string,
        );
      case 'sendDice':
        return bot.api.sendDice(action.payload.chatId as number, '🎲');
      case 'react':
        if (action.payload.chatId === undefined || action.payload.messageId === undefined) {
          throw new Error('react requires chatId and messageId');
        }
        return bot.api.setMessageReaction(
          action.payload.chatId as number,
          action.payload.messageId as number,
          [
            {
              type: 'emoji',
              emoji: (action.payload.reaction as string) ?? '👍',
            } as TelegramReaction,
          ],
        );
      default:
        throw new Error(`Unknown action: ${action.type}`);
    }
  }

  protected hasLiveConnection(botId: string): boolean {
    return this.instances.has(botId);
  }

  /**
   * FIFO chain per bot: webhook updates for the same bot run strictly one at a
   * time. Polling processes updates sequentially by nature; the webhook queue
   * runs jobs concurrently (and across processes), which would let updates
   * interleave and break the per-bot script step machine. Different bots stay
   * fully parallel.
   */
  private readonly updateChains = new Map<string, Promise<void>>();

  /**
   * Processes a Telegram webhook update enqueued by the API. grammy's
   * `handleUpdate` runs the same middleware chain registered in connect(), so
   * webhook mode and long polling produce identical events/script behavior.
   */
  public handleUpdate(botId: string, update: Record<string, unknown>): Promise<void> {
    const previous = this.updateChains.get(botId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.processUpdate(botId, update));
    this.updateChains.set(botId, next);
    return next;
  }

  private async processUpdate(botId: string, update: Record<string, unknown>): Promise<void> {
    const bot = this.instances.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not connected`);
    await bot.handleUpdate(update as unknown as TelegramUpdate);
  }

  /**
   * A running bot whose polling loop died (401 revoked token / 409 duplicate
   * instance) is dropped from the live instances and handed back to the
   * standard reconnect machinery, so the connection is restored with backoff
   * instead of staying a zombie. The `start()` rejection that triggered this
   * still propagates to the connect() caller (processJob / attemptReconnect /
   * autoStartBots), which schedules the reconnect exactly once — scheduling it
   * here as well would double-increment reconnectAttempts.
   */
  private async restoreConnection(botId: string): Promise<void> {
    this.instances.delete(botId);
    await this.markReconnecting(botId);
    await this.writeLog(botId, 'warn', 'Telegram polling loop failed; reconnecting');
  }
}
