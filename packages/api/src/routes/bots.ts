import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Result } from '@bothive/core';
import {
  AppError, CreateBotSchema, UpdateBotSchema, PlatformSchema,
  commandBus, RestartBotCommand, ExecuteBotActionCommand, UpdateBotCommand,
} from '@bothive/core';
import { enqueueConnect, enqueueDisconnect } from '../services/queue.js';
import { getBotMemory, clearBotMemory, deleteBotMemoryKey } from '../services/memory.js';
import { extractCredentials } from '../utils/credentials.js';
import { parsePage } from '../utils/query.js';
import { requireAuth } from '../utils/auth-hook.js';

function sendResult<T>(reply: FastifyReply, result: Result<T, AppError>): void {
  if (result.isErr) {
    reply.status(result.error.statusCode).send({
      success: false,
      error: { code: result.error.code, message: result.error.message },
    });
    return;
  }
  reply.send({ success: true, data: result.value });
}

export async function botRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', async (request, reply) => {
    const { take, skip } = parsePage(request.query as Record<string, unknown>, { limit: 100, maxLimit: 1000 });

    // Optional filters: ?platform=telegram&status=running&q=name-substring.
    // platform/status hit the Bot(platform, status) index; the query is kept
    // bounded by the same pagination as the unfiltered list.
    const query = request.query as Record<string, unknown>;
    const where: Record<string, unknown> = {};
    if (typeof query.platform === 'string' && query.platform.length > 0) {
      const platform = PlatformSchema.safeParse(query.platform);
      if (!platform.success) {
        return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid platform' } });
      }
      where.platform = platform.data;
    }
    if (typeof query.status === 'string' && query.status.length > 0) {
      where.status = query.status;
    }
    if (typeof query.q === 'string' && query.q.trim().length > 0) {
      where.name = { contains: query.q.trim(), mode: 'insensitive' };
    }

    const bots = await request.prisma.bot.findMany({
      where,
      include: { account: { select: { id: true, name: true, platform: true, createdAt: true, updatedAt: true } }, _count: { select: { logs: true } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return { success: true, data: bots };
  });

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({
      where: { id: request.params.id },
      include: { account: { select: { id: true, name: true, platform: true, createdAt: true, updatedAt: true } }, logs: { take: 50, orderBy: { createdAt: 'desc' } }, scripts: true },
    });
    if (!bot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });
    return { success: true, data: bot };
  });

  app.get<{ Params: { id: string } }>('/:id/memory', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const entries = await getBotMemory(bot.id);
    return { success: true, data: entries };
  });

  app.delete<{ Params: { id: string; key: string } }>('/:id/memory/:key', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const removed = await deleteBotMemoryKey(bot.id, request.params.key);
    return { success: true, data: { removed } };
  });

  app.delete<{ Params: { id: string } }>('/:id/memory', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const cleared = await clearBotMemory(bot.id);
    return { success: true, data: { cleared } };
  });

  app.post<{ Body: { name: string; platform: string; accountId: string; config?: object } }>('/', async (request, reply) => {
    const parsed = CreateBotSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten().fieldErrors } });

    const account = await request.prisma.account.findUnique({ where: { id: parsed.data.accountId } });
    if (!account) return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: { accountId: 'account does not exist' } } });
    if (account.platform !== parsed.data.platform) {
      return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: { platform: `account belongs to ${account.platform}` } } });
    }

    const bot = await request.prisma.bot.create({
      data: { name: parsed.data.name, platform: parsed.data.platform, accountId: parsed.data.accountId, config: (parsed.data.config ?? {}) as object },
    });
    return { success: true, data: bot };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; config?: object } }>('/:id', async (request, reply) => {
    const parsed = UpdateBotSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten().fieldErrors } });

    const result = await commandBus.dispatch(new UpdateBotCommand(request.params.id, parsed.data));
    sendResult(reply, result);
  });

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    await enqueueDisconnect(bot.id, bot.platform);

    // Delete atomically; webhooks scoped to this bot become global (botId null)
    // instead of being removed or left pointing at a deleted bot.
    await request.prisma.$transaction([
      request.prisma.log.deleteMany({ where: { botId: bot.id } }),
      request.prisma.script.deleteMany({ where: { botId: bot.id } }),
      request.prisma.webhook.updateMany({ where: { botId: bot.id }, data: { botId: null } }),
      request.prisma.bot.delete({ where: { id: bot.id } }),
    ]);
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/:id/start', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id }, include: { account: true } });
    if (!bot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const credentials = extractCredentials(bot);
    await request.prisma.bot.update({ where: { id: bot.id }, data: { status: 'connecting' } });
    await enqueueConnect(bot.id, bot.platform, credentials);
    return { success: true, message: 'Bot start queued' };
  });

  app.post<{ Params: { id: string } }>('/:id/stop', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    await enqueueDisconnect(bot.id, bot.platform);
    await request.prisma.bot.update({ where: { id: bot.id }, data: { status: 'idle' } });
    return { success: true, message: 'Bot stop queued' };
  });

  app.post<{ Params: { id: string } }>('/:id/restart', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id }, include: { account: true } });
    if (!bot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const credentials = extractCredentials(bot);
    const result = await commandBus.dispatch(new RestartBotCommand(bot.id, bot.platform, credentials));
    if (result.isErr) {
      return reply.status(result.error.statusCode).send({ success: false, error: { code: result.error.code, message: result.error.message } });
    }
    return { success: true, message: 'Bot restart queued' };
  });

  app.post<{ Params: { id: string }; Body: { type: string; payload?: Record<string, unknown> } }>('/:id/action', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const { type, payload } = request.body ?? {};
    if (typeof type !== 'string' || type.length === 0) {
      return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: { type: 'must be a non-empty string' } } });
    }
    if (payload !== undefined && (typeof payload !== 'object' || Array.isArray(payload) || payload === null)) {
      return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: { payload: 'must be an object' } } });
    }

    const result = await commandBus.dispatch(new ExecuteBotActionCommand(bot.id, bot.platform, type, (payload ?? {}) as Record<string, unknown>));
    if (result.isErr) {
      return reply.status(result.error.statusCode).send({ success: false, error: { code: result.error.code, message: result.error.message } });
    }
    return { success: true, message: 'Action queued' };
  });
}
