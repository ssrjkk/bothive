import type { CommandHandler, QueryHandler } from '@bothive/core';
import {
  StartBotCommand, StopBotCommand, RestartBotCommand,
  ExecuteBotActionCommand, CreateBotCommand, DeleteBotCommand,
  UpdateBotCommand, GetBotQuery, ListBotsQuery, GetBotStatsQuery,
} from '@bothive/core';
import { ok, err, AppError, type Result } from '@bothive/core';
import type { PrismaClient } from '@prisma/client';
import { enqueueConnect, enqueueDisconnect, enqueueAction, getQueue } from '../../services/queue.js';
import { extractCredentials } from '../../utils/credentials.js';

export class StartBotHandler implements CommandHandler<StartBotCommand, void> {
  readonly commandType = 'bot.start';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(command: StartBotCommand): Promise<Result<void, AppError>> {
    try {
      const bot = await this.prisma.bot.findUnique({
        where: { id: command.botId },
        include: { account: true },
      });
      if (!bot) return err(AppError.notFound(`Bot ${command.botId} not found`));

      await enqueueConnect(command.botId, command.platform, command.credentials);
      await this.prisma.bot.update({ where: { id: command.botId }, data: { status: 'connecting' } });
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
      await enqueueDisconnect(command.botId, command.platform);
      await this.prisma.bot.update({ where: { id: command.botId }, data: { status: 'idle' } });
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
      const bot = await this.prisma.bot.findUnique({
        where: { id: command.botId },
        include: { account: true },
      });
      if (!bot) return err(AppError.notFound(`Bot ${command.botId} not found`));

      await enqueueDisconnect(command.botId, command.platform);
      await this.prisma.bot.update({ where: { id: command.botId }, data: { status: 'reconnecting' } });

      const queue = getQueue(command.platform);
      await queue.add('connect', {
        id: command.botId,
        type: 'connect',
        botId: command.botId,
        data: { ...command.credentials, botId: command.botId },
      }, {
        jobId: `connect:${command.botId}`,
        delay: 1000,
        attempts: 1,
      });

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

export class CreateBotHandler implements CommandHandler<CreateBotCommand, { id: string }> {
  readonly commandType = 'bot.create';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(command: CreateBotCommand): Promise<Result<{ id: string }, AppError>> {
    try {
      const bot = await this.prisma.bot.create({
        data: {
          name: command.name,
          platform: command.platform,
          accountId: command.accountId,
          config: (command.config ?? {}) as object,
        },
      });
      return ok({ id: bot.id });
    } catch (e) {
      return err(AppError.internal(`Failed to create bot: ${e}`));
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

      await enqueueDisconnect(command.botId, bot.platform);
      await this.prisma.log.deleteMany({ where: { botId: command.botId } });
      await this.prisma.script.deleteMany({ where: { botId: command.botId } });
      await this.prisma.bot.delete({ where: { id: command.botId } });
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
      if (command.data.config !== undefined) data.config = command.data.config as object;

      const updated = await this.prisma.bot.update({ where: { id: command.botId }, data });
      return ok(updated as unknown as Record<string, unknown>);
    } catch (e) {
      return err(AppError.internal(`Failed to update bot: ${e}`));
    }
  }
}

export class GetBotHandler implements QueryHandler<GetBotQuery, Record<string, unknown>> {
  readonly queryType = 'bot.get';

  constructor(private readonly prisma: PrismaClient) {}

  async handle(query: GetBotQuery): Promise<Result<Record<string, unknown>, AppError>> {
    try {
      const bot = await this.prisma.bot.findUnique({
        where: { id: query.botId },
        include: { account: { select: { id: true, name: true, platform: true, createdAt: true, updatedAt: true } }, scripts: true, logs: { take: 50, orderBy: { createdAt: 'desc' } } },
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
        include: { account: { select: { id: true, name: true, platform: true, createdAt: true, updatedAt: true } }, _count: { select: { logs: true } } },
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
        by: ['platform'], _count: { id: true },
      });
      const byStatus = await this.prisma.bot.groupBy({
        by: ['status'], _count: { id: true },
      });

      return ok({ totalBots, activeBots, totalAccounts, recentLogs24h, byPlatform, byStatus });
    } catch (e) {
      return err(AppError.internal(`Failed to get stats: ${e}`));
    }
  }
}
