import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Result } from '@bothive/core';
import {
  AppError,
  CreateBotSchema,
  UpdateBotSchema,
  PlatformSchema,
  commandBus,
  RestartBotCommand,
  ExecuteBotActionCommand,
  UpdateBotCommand,
  encryptCredential,
  generateCryptoConfig,
  generateEVMWallet,
} from '@bothive/core';
import { enqueueConnect, enqueueDisconnect } from '../services/queue.js';
import {
  getBotMemory,
  clearBotMemory,
  deleteBotMemoryKey,
  deleteBotRuntimeState,
  getCryptoState,
} from '../services/memory.js';
import { parsePage } from '../utils/query.js';
import { requireAuth } from '../utils/auth-hook.js';
import { notifyScriptsChanged } from '../services/script-events.js';

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
    const { take, skip } = parsePage(request.query as Record<string, unknown>, {
      limit: 100,
      maxLimit: 1000,
    });

    // Optional filters: ?platform=telegram&status=running&q=name-substring.
    // platform/status hit the Bot(platform, status) index; the query is kept
    // bounded by the same pagination as the unfiltered list.
    const query = request.query as Record<string, unknown>;
    const where: Record<string, unknown> = {};
    if (typeof query.platform === 'string' && query.platform.length > 0) {
      const platform = PlatformSchema.safeParse(query.platform);
      if (!platform.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid platform' },
        });
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
      include: {
        account: {
          select: { id: true, name: true, platform: true, createdAt: true, updatedAt: true },
        },
        _count: { select: { logs: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return { success: true, data: bots };
  });

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({
      where: { id: request.params.id },
      include: {
        account: {
          select: { id: true, name: true, platform: true, createdAt: true, updatedAt: true },
        },
        logs: { take: 50, orderBy: { createdAt: 'desc' } },
        scripts: true,
      },
    });
    if (!bot)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });
    return { success: true, data: bot };
  });

  app.get<{ Params: { id: string } }>('/:id/memory', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const limitRaw = Number((request.query as { limit?: string }).limit ?? 1000);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 1000;
    const entries = await getBotMemory(bot.id, limit);
    return { success: true, data: entries };
  });

  app.get<{ Params: { id: string } }>('/:id/crypto/state', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });
    if (bot.platform !== 'crypto')
      return reply.status(422).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Bot is not a crypto bot' },
      });

    const state = await getCryptoState(bot.id);
    return { success: true, data: state };
  });

  app.delete<{ Params: { id: string; key: string } }>(
    '/:id/memory/:key',
    async (request, reply) => {
      const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
      if (!bot)
        return reply
          .status(404)
          .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

      const key = request.params.key;
      if (/[*?\[]/.test(key)) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Key contains invalid characters' },
        });
      }

      const removed = await deleteBotMemoryKey(bot.id, key);
      return { success: true, data: { removed } };
    },
  );

  app.delete<{ Params: { id: string } }>('/:id/memory', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const cleared = await clearBotMemory(bot.id);
    return { success: true, data: { cleared } };
  });

  app.post<{ Body: { name: string; platform: string; accountId: string; config?: object } }>(
    '/',
    async (request, reply) => {
      const parsed = CreateBotSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: parsed.error.flatten().fieldErrors,
          },
        });

      const account = await request.prisma.account.findUnique({
        where: { id: parsed.data.accountId },
      });
      if (!account)
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: { accountId: 'account does not exist' },
          },
        });
      if (account.platform !== parsed.data.platform) {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: { platform: `account belongs to ${account.platform}` },
          },
        });
      }

      let config = (parsed.data.config ?? {}) as Record<string, unknown>;
      if (parsed.data.platform === 'crypto') {
        // Crypto bots get a varied out-of-the-box config (different pairs,
        // strategies, cadence) and a dedicated EVM wallet; the private key is
        // stored encrypted so the address is the only wallet data exposed.
        config = { ...config };
        const crypto = (
          config.crypto && typeof config.crypto === 'object' ? config.crypto : {}
        ) as Record<string, unknown>;
        if (!crypto.symbols) Object.assign(crypto, generateCryptoConfig());
        if (!crypto.wallet) {
          const wallet = generateEVMWallet();
          crypto.wallet = {
            address: wallet.address,
            privateKey: encryptCredential(wallet.privateKey),
          };
        }
        config.crypto = crypto;
      }

      const bot = await request.prisma.bot.create({
        data: {
          name: parsed.data.name,
          platform: parsed.data.platform,
          accountId: parsed.data.accountId,
          config: config as object,
        },
      });
      return { success: true, data: bot };
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; config?: object } }>(
    '/:id',
    async (request, reply) => {
      const parsed = UpdateBotSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: parsed.error.flatten().fieldErrors,
          },
        });

      const result = await commandBus.dispatch(
        new UpdateBotCommand(request.params.id, parsed.data),
      );
      sendResult(reply, result);
    },
  );

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    // Delete atomically first, then disconnect — prevents a race where the
    // disconnect job arrives at the worker after the bot row is already gone.
    // Webhooks scoped to this bot become global (botId null) instead of being
    // removed or left pointing at a deleted bot.
    await request.prisma.$transaction([
      request.prisma.log.deleteMany({ where: { botId: bot.id } }),
      request.prisma.script.deleteMany({ where: { botId: bot.id } }),
      request.prisma.webhook.updateMany({ where: { botId: bot.id }, data: { botId: null } }),
      request.prisma.bot.delete({ where: { id: bot.id } }),
    ]);

    // Best-effort disconnect — no-op if the worker already released the bot.
    await enqueueDisconnect(bot.id, bot.platform);
    // Best-effort cleanup of the bot's Redis state (memory, dry-run positions,
    // daily spend): a Redis outage must not block the deletion.
    await deleteBotRuntimeState(bot.id).catch((e) =>
      console.error(`[api] Redis cleanup for deleted bot ${bot.id} failed:`, e),
    );
    // The scripts were cascade-deleted above; purge them from the workers'
    // engine too (targeted reload by bot, not a full registry reset).
    notifyScriptsChanged([bot.id]);
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/:id/start', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    await request.prisma.bot.update({ where: { id: bot.id }, data: { status: 'connecting' } });
    await enqueueConnect(bot.id, bot.platform);
    return { success: true, message: 'Bot start queued' };
  });

  app.post<{ Params: { id: string } }>('/:id/stop', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    // Record the intent before enqueueing so the disconnect job reads the
    // newest status: a stale disconnect (retried from before a restart) must
    // not tear down a bot the DB says should be running.
    await request.prisma.bot.update({ where: { id: bot.id }, data: { status: 'idle' } });
    await enqueueDisconnect(bot.id, bot.platform);
    return { success: true, message: 'Bot stop queued' };
  });

  app.post<{ Params: { id: string } }>('/:id/restart', async (request, reply) => {
    const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
    if (!bot)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const result = await commandBus.dispatch(new RestartBotCommand(bot.id, bot.platform));
    if (result.isErr) {
      return reply.status(result.error.statusCode).send({
        success: false,
        error: { code: result.error.code, message: result.error.message },
      });
    }
    return { success: true, message: 'Bot restart queued' };
  });

  app.post<{ Params: { id: string }; Body: { type: string; payload?: Record<string, unknown> } }>(
    '/:id/action',
    async (request, reply) => {
      const bot = await request.prisma.bot.findUnique({ where: { id: request.params.id } });
      if (!bot)
        return reply
          .status(404)
          .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

      const { type, payload } = request.body ?? {};
      if (typeof type !== 'string' || type.length === 0) {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: { type: 'must be a non-empty string' },
          },
        });
      }
      if (
        payload !== undefined &&
        (typeof payload !== 'object' || Array.isArray(payload) || payload === null)
      ) {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: { payload: 'must be an object' },
          },
        });
      }

      const result = await commandBus.dispatch(
        new ExecuteBotActionCommand(
          bot.id,
          bot.platform,
          type,
          (payload ?? {}) as Record<string, unknown>,
        ),
      );
      if (result.isErr) {
        return reply.status(result.error.statusCode).send({
          success: false,
          error: { code: result.error.code, message: result.error.message },
        });
      }
      return { success: true, message: 'Action queued' };
    },
  );
}
