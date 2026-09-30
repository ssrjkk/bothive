import type { CommandHandler, QueryHandler } from '@bothive/core';
import {
  StartBotCommand,
  StopBotCommand,
  RestartBotCommand,
  ExecuteBotActionCommand,
  DeleteBotCommand,
  UpdateBotCommand,
  GetBotQuery,
  ListBotsQuery,
  GetBotStatsQuery,
} from '@bothive/core';
import { ok, err, AppError, type Result, encryptCredential, ensureEncrypted } from '@bothive/core';
import type { PrismaClient } from '../../../prisma/generated/prisma/client.js';
import {
  enqueueConnect,
  enqueueDisconnect,
  enqueueAction,
  getQueue,
} from '../../services/queue.js';
import { notifyScriptsChanged } from '../../services/script-events.js';

export class StartBotHandler implements CommandHandler<StartBotCommand, void> {
  readonly commandType = 'bot.start';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(command: StartBotCommand): Promise<Result<void, AppError>> {
    try {
      const bot = await this.prisma.bot.findUnique({ where: { id: command.botId } });
      if (!bot) return err(AppError.notFound(`Bot ${command.botId} not found`));

      // Record the intent before enqueueing so a worker-side guard can read
      // it: a connect job arriving late (after a stop) must see the newest
      // status instead of the pre-start one.
      await this.prisma.bot.update({
        where: { id: command.botId },
        data: { status: 'connecting' },
      });
      try {
        await enqueueConnect(command.botId, command.platform);
      } catch (enqueueErr) {
        // If the queue is unreachable, revert the status so the bot is not
        // stuck in "connecting" forever. The watchdog would catch this
        // eventually (2 min), but reverting immediately is cleaner.
        await this.prisma.bot
          .update({ where: { id: command.botId }, data: { status: 'idle' } })
          .catch(() => {});
        throw enqueueErr;
      }
      return ok(undefined);
    } catch (e) {
      return err(AppError.internal(`Failed to start bot: ${e}`));
    }
  }
}

export class StopBotHandler implements CommandHandler<StopBotCommand, void> {
  readonly commandType = 'bot.stop';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(command: StopBotCommand): Promise<Result<void, AppError>> {
    try {
      // Record the intent before enqueueing so the disconnect job reads the
      // newest status: a stale disconnect (retried from before a restart) must
      // not tear down a bot the DB says should be running.
      await this.prisma.bot.update({ where: { id: command.botId }, data: { status: 'idle' } });
      try {
        await enqueueDisconnect(command.botId, command.platform);
      } catch {
        // Queue unreachable: the bot is already set to idle, which is the
        // correct final state for a stop. No revert needed.
      }
      return ok(undefined);
    } catch (e) {
      return err(AppError.internal(`Failed to stop bot: ${e}`));
    }
  }
}

export class RestartBotHandler implements CommandHandler<RestartBotCommand, void> {
  readonly commandType = 'bot.restart';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(command: RestartBotCommand): Promise<Result<void, AppError>> {
    try {
      const bot = await this.prisma.bot.findUnique({ where: { id: command.botId } });
      if (!bot) return err(AppError.notFound(`Bot ${command.botId} not found`));

      // No disconnect job: the connect job itself replaces the live connection
      // (its guard lets 'reconnecting' override a live connection and clears
      // any pending reconnect timer), so a restart cannot be broken by a
      // stale stop-disconnect landing in the middle of it.
      await this.prisma.bot.update({
        where: { id: command.botId },
        data: { status: 'reconnecting' },
      });

      const queue = getQueue(command.platform);
      // No credentials in the payload: the worker resolves them from the DB.
      try {
        await queue.add(
          'connect',
          {
            id: command.botId,
            type: 'connect',
            botId: command.botId,
            data: {},
          },
          {
            jobId: `connect-${command.botId}`,
            delay: 1000,
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      } catch {
        // Queue unreachable: revert to idle so the bot is not stuck in
        // "reconnecting". The watchdog would catch this (2 min) but reverting
        // immediately is cleaner.
        await this.prisma.bot
          .update({ where: { id: command.botId }, data: { status: 'idle' } })
          .catch(() => {});
        return err(AppError.internal('Failed to enqueue restart: queue unreachable'));
      }

      return ok(undefined);
    } catch (e) {
      return err(AppError.internal(`Failed to restart bot: ${e}`));
    }
  }
}

export class ExecuteBotActionHandler implements CommandHandler<ExecuteBotActionCommand, void> {
  readonly commandType = 'bot.execute';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(command: ExecuteBotActionCommand): Promise<Result<void, AppError>> {
    try {
      const bot = await this.prisma.bot.findUnique({ where: { id: command.botId } });
      if (!bot) return err(AppError.notFound(`Bot ${command.botId} not found`));

      await enqueueAction(command.botId, command.platform, {
        type: command.actionType,
        payload: command.payload,
      });
      return ok(undefined);
    } catch (e) {
      return err(AppError.internal(`Failed to execute action: ${e}`));
    }
  }
}

export class DeleteBotHandler implements CommandHandler<DeleteBotCommand, void> {
  readonly commandType = 'bot.delete';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(command: DeleteBotCommand): Promise<Result<void, AppError>> {
    try {
      const bot = await this.prisma.bot.findUnique({ where: { id: command.botId } });
      if (!bot) return err(AppError.notFound(`Bot ${command.botId} not found`));

      // Atomic: all three deletions in one transaction prevents orphaned data
      // if the process crashes mid-operation.
      await this.prisma.$transaction(async (tx) => {
        await tx.log.deleteMany({ where: { botId: command.botId } });
        await tx.script.deleteMany({ where: { botId: command.botId } });
        await tx.bot.delete({ where: { id: command.botId } });
      });
      // Redis cleanup is best-effort, outside the DB transaction.
      void enqueueDisconnect(command.botId, bot.platform).catch(() => {});
      notifyScriptsChanged([command.botId]);
      return ok(undefined);
    } catch (e) {
      return err(AppError.internal(`Failed to delete bot: ${e}`));
    }
  }
}

export class UpdateBotHandler implements CommandHandler<UpdateBotCommand, Record<string, unknown>> {
  readonly commandType = 'bot.update';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(command: UpdateBotCommand): Promise<Result<Record<string, unknown>, AppError>> {
    try {
      const bot = await this.prisma.bot.findUnique({ where: { id: command.botId } });
      if (!bot) return err(AppError.notFound(`Bot ${command.botId} not found`));

      const data: Record<string, unknown> = {};
      if (command.data.name !== undefined) data.name = command.data.name;
      if (command.data.config !== undefined) {
        data.config = preserveWalletKey(bot.config, command.data.config as Record<string, unknown>);
      }

      const updated = await this.prisma.bot.update({ where: { id: command.botId }, data });
      return ok(updated as unknown as Record<string, unknown>);
    } catch (e) {
      return err(AppError.internal(`Failed to update bot: ${e}`));
    }
  }
}

/**
 * The API never returns the crypto wallet private key, so a client that saves
 * a config it fetched (dashboard JSON editor, ResilienceForm merge, scripts)
 * simply cannot include it. Without this merge every such save would silently
 * destroy the key. When the incoming config carries a wallet WITHOUT a private
 * key and the stored config HAS one, the stored key is re-attached. A wallet
 * explicitly sent with a different key (e.g. backup restore / manual import)
 * replaces it as before.
 */
function preserveWalletKey(
  storedConfig: unknown,
  incomingConfig: Record<string, unknown>,
): Record<string, unknown> {
  const incomingCrypto = incomingConfig.crypto as Record<string, unknown> | undefined;
  const incomingWallet = incomingCrypto?.wallet as Record<string, unknown> | undefined;
  if (!incomingCrypto || !incomingWallet) return incomingConfig;
  if (typeof incomingWallet.privateKey === 'string') {
    // A NEW key was sent explicitly (backup restore / manual import): encrypt
    // it on the way in — a raw private key must never be stored as-is.
    if (!incomingWallet.privateKey.startsWith('enc:')) {
      incomingCrypto.wallet = {
        ...incomingWallet,
        privateKey: encryptCredential(incomingWallet.privateKey),
      };
    }
    return incomingConfig;
  }

  const storedCrypto = (storedConfig as Record<string, unknown> | null | undefined)?.crypto as
    Record<string, unknown> | undefined;
  const storedWallet = storedCrypto?.wallet as Record<string, unknown> | undefined;
  if (!storedWallet || typeof storedWallet.privateKey !== 'string') return incomingConfig;

  incomingCrypto.wallet = {
    ...incomingWallet,
    privateKey: ensureEncrypted(storedWallet.privateKey),
  };
  return incomingConfig;
}

export class GetBotHandler implements QueryHandler<GetBotQuery, Record<string, unknown>> {
  readonly queryType = 'bot.get';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(query: GetBotQuery): Promise<Result<Record<string, unknown>, AppError>> {
    try {
      const bot = await this.prisma.bot.findUnique({
        where: { id: query.botId },
        include: {
          account: {
            select: { id: true, name: true, platform: true, createdAt: true, updatedAt: true },
          },
          scripts: true,
          logs: { take: 50, orderBy: { createdAt: 'desc' } },
        },
      });
      if (!bot) return err(AppError.notFound(`Bot ${query.botId} not found`));
      return ok(bot as unknown as Record<string, unknown>);
    } catch (e) {
      return err(AppError.internal(`Failed to get bot: ${e}`));
    }
  }
}

export class ListBotsHandler implements QueryHandler<ListBotsQuery, unknown[]> {
  readonly queryType = 'bot.list';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(query: ListBotsQuery): Promise<Result<unknown[], AppError>> {
    try {
      const where: Record<string, unknown> = {};
      if (query.filter?.platform) where.platform = query.filter.platform;
      if (query.filter?.status) where.status = query.filter.status;

      const bots = await this.prisma.bot.findMany({
        where,
        include: {
          account: {
            select: { id: true, name: true, platform: true, createdAt: true, updatedAt: true },
          },
          _count: { select: { logs: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return ok(bots);
    } catch (e) {
      return err(AppError.internal(`Failed to list bots: ${e}`));
    }
  }
}

export class BotStatsHandler implements QueryHandler<GetBotStatsQuery, Record<string, unknown>> {
  readonly queryType = 'bot.stats';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(_query: GetBotStatsQuery): Promise<Result<Record<string, unknown>, AppError>> {
    try {
      const [totalBots, activeBots, totalAccounts, recentLogs24h] = await Promise.all([
        this.prisma.bot.count(),
        this.prisma.bot.count({ where: { status: 'running' } }),
        this.prisma.account.count(),
        this.prisma.log.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) } } }),
      ]);

      const byPlatform = await this.prisma.bot.groupBy({
        by: ['platform'],
        _count: { id: true },
      });
      const byStatus = await this.prisma.bot.groupBy({
        by: ['status'],
        _count: { id: true },
      });

      return ok({ totalBots, activeBots, totalAccounts, recentLogs24h, byPlatform, byStatus });
    } catch (e) {
      return err(AppError.internal(`Failed to get stats: ${e}`));
    }
  }
}
