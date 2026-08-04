import { commandBus, queryBus } from '@bothive/core';
import type { PrismaClient } from '@prisma/client';
import {
  StartBotHandler, StopBotHandler, RestartBotHandler, ExecuteBotActionHandler,
  CreateBotHandler, DeleteBotHandler, UpdateBotHandler,
  GetBotHandler, ListBotsHandler, BotStatsHandler,
} from './handlers/bot-handlers.js';

export function registerHandlers(prisma: PrismaClient): void {
  commandBus.register(new StartBotHandler(prisma));
  commandBus.register(new StopBotHandler(prisma));
  commandBus.register(new RestartBotHandler(prisma));
  commandBus.register(new ExecuteBotActionHandler(prisma));
  commandBus.register(new CreateBotHandler(prisma));
  commandBus.register(new DeleteBotHandler(prisma));
  commandBus.register(new UpdateBotHandler(prisma));

  queryBus.register(new GetBotHandler(prisma));
  queryBus.register(new ListBotsHandler(prisma));
  queryBus.register(new BotStatsHandler(prisma));

  console.log(`Registered ${commandBus.registeredCommands.length} commands and ${queryBus.registeredQueries.length} queries`);
}
