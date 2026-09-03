import type { FastifyInstance } from 'fastify';
import {
  CreateScriptSchema,
  ScriptTriggerSchema,
  getPattern,
  listPatterns,
  validateScriptConfig,
} from '@bothive/core';
import { notifyScriptsChanged } from '../services/script-events.js';
import { redisConnection } from '../services/queue.js';
import { parsePage } from '../utils/query.js';
import { requireAuth } from '../utils/auth-hook.js';
import { requestOwnerId, sendNotFound } from '../utils/tenancy.js';

const TRIGGER_CHANNEL = 'bothive:script:trigger';

const UPDATE_FIELDS = ['name', 'trigger', 'config', 'enabled'] as const;

export async function scriptRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    const { take, skip } = parsePage(request.query as Record<string, unknown>, {
      limit: 100,
      maxLimit: 1000,
    });
    const scripts = await request.prisma.script.findMany({
      where: { bot: { ownerId: requestOwnerId(request) } },
      include: { bot: { select: { id: true, name: true, platform: true } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return { success: true, data: scripts };
  });

  app.get('/patterns', async () => ({
    success: true,
    data: listPatterns(),
  }));

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const script = await request.prisma.script.findFirst({
      where: { id: request.params.id, bot: { ownerId: requestOwnerId(request) } },
      include: { bot: true },
    });
    if (!script) return sendNotFound(reply);
    return { success: true, data: script };
  });

  app.post<{ Params: { id: string }; Body?: { sample?: Record<string, unknown> } }>(
    '/:id/test',
    async (request, reply) => {
      const script = await request.prisma.script.findFirst({
        where: { id: request.params.id, bot: { ownerId: requestOwnerId(request) } },
      });
      if (!script) return sendNotFound(reply);

      const body = request.body ?? {};
      const sample = body.sample ?? {};
      if (typeof sample !== 'object' || sample === null || Array.isArray(sample)) {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: { sample: 'must be an object' },
          },
        });
      }

      await redisConnection.publish(
        TRIGGER_CHANNEL,
        JSON.stringify({ botId: script.botId, scriptId: script.id, sample }),
      );
      return { success: true, message: 'Test trigger published to workers' };
    },
  );

  app.post<{ Params: { id: string } }>('/:id/clone', async (request, reply) => {
    const ownerId = requestOwnerId(request);
    const script = await request.prisma.script.findFirst({
      where: { id: request.params.id, bot: { ownerId } },
    });
    if (!script) return sendNotFound(reply);

    const clone = await request.prisma.script.create({
      data: {
        botId: script.botId,
        name: `${script.name} (copy)`.slice(0, 100),
        trigger: script.trigger,
        config: script.config as object,
        enabled: false,
      },
    });
    notifyScriptsChanged([script.botId]);
    return { success: true, data: clone };
  });

  app.post<{
    Body: {
      botId: string;
      name: string;
      pattern: string;
      params?: Record<string, unknown>;
      enabled?: boolean;
    };
  }>('/generate', async (request, reply) => {
    const body = request.body ?? {};
    if (typeof body.botId !== 'string' || body.botId.length === 0) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: { botId: 'required' },
        },
      });
    }
    if (typeof body.name !== 'string' || body.name.length === 0) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: { name: 'required' },
        },
      });
    }
    if (body.name.length > 100) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: { name: 'must be 100 characters or fewer' },
        },
      });
    }
    if (typeof body.pattern !== 'string' || body.pattern.length === 0) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: { pattern: 'required' },
        },
      });
    }

    const pattern = getPattern(body.pattern);
    if (!pattern) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `Pattern "${body.pattern}" not found` },
      });
    }

    const ownerId = requestOwnerId(request);
    const bot = await request.prisma.bot.findUnique({
      where: { id: body.botId, ownerId },
    });
    if (!bot)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const params = body.params ?? {};
    const missing = pattern.params.filter(
      (spec) =>
        spec.required &&
        (params[spec.key] === undefined || params[spec.key] === null || params[spec.key] === ''),
    );
    if (missing.length > 0) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required parameters',
          details: Object.fromEntries(missing.map((spec) => [spec.key, 'required'])),
        },
      });
    }

    const generated = pattern.generate(params);
    const configErrors = validateScriptConfig(generated);
    if (configErrors.length > 0) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Generated config failed safety checks',
          details: { config: configErrors },
        },
      });
    }
    if (!ScriptTriggerSchema.safeParse(generated.trigger).success) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Generated trigger is not supported',
          details: { trigger: generated.trigger },
        },
      });
    }
    const script = await request.prisma.script.create({
      data: {
        botId: body.botId,
        name: body.name,
        trigger: generated.trigger,
        config: { ...generated } as object,
        enabled: body.enabled ?? true,
      },
    });
    notifyScriptsChanged([body.botId]);
    return { success: true, data: script };
  });

  app.post<{
    Body: { botId: string; name: string; trigger: string; config: object; enabled?: boolean };
  }>('/', async (request, reply) => {
    const parsed = CreateScriptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    const bot = await request.prisma.bot.findUnique({
      where: { id: parsed.data.botId, ownerId: requestOwnerId(request) },
    });
    if (!bot)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Bot not found' } });

    const configErrors = validateScriptConfig(parsed.data.config);
    if (configErrors.length > 0) {
      return reply.status(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Script config failed safety checks',
          details: { config: configErrors },
        },
      });
    }

    const script = await request.prisma.script.create({
      data: {
        botId: parsed.data.botId,
        name: parsed.data.name,
        trigger: parsed.data.trigger,
        config: parsed.data.config as object,
        enabled: parsed.data.enabled ?? true,
      },
    });
    notifyScriptsChanged([parsed.data.botId]);
    return { success: true, data: script };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/:id',
    async (request, reply) => {
      const ownerId = requestOwnerId(request);
      const script = await request.prisma.script.findFirst({
        where: { id: request.params.id, bot: { ownerId } },
      });
      if (!script) return sendNotFound(reply);

      const body = request.body ?? {};
      const data: Record<string, unknown> = {};
      for (const field of UPDATE_FIELDS) {
        if (body[field] !== undefined) data[field] = body[field];
      }
      if (
        data.config !== undefined &&
        (typeof data.config !== 'object' || data.config === null || Array.isArray(data.config))
      ) {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: { config: 'must be an object' },
          },
        });
      }
      if (data.config !== undefined) {
        const configErrors = validateScriptConfig(data.config);
        if (configErrors.length > 0) {
          return reply.status(422).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Script config failed safety checks',
              details: { config: configErrors },
            },
          });
        }
      }
      if (data.name !== undefined) {
        if (typeof data.name !== 'string' || data.name.length === 0 || data.name.length > 100) {
          return reply.status(422).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid input',
              details: { name: 'must be 1-100 characters' },
            },
          });
        }
      }
      if (data.enabled !== undefined && typeof data.enabled !== 'boolean') {
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: { enabled: 'must be a boolean' },
          },
        });
      }
      if (data.trigger !== undefined) {
        const parsed = ScriptTriggerSchema.safeParse(data.trigger);
        if (!parsed.success) {
          return reply.status(422).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid input',
              details: { trigger: `must be one of: ${ScriptTriggerSchema.options.join(', ')}` },
            },
          });
        }
        data.trigger = parsed.data;
      }

      const updated = await request.prisma.script.update({
        where: { id: request.params.id, bot: { ownerId } },
        data,
      });
      notifyScriptsChanged([script.botId]);
      return { success: true, data: updated };
    },
  );

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const ownerId = requestOwnerId(request);
    const script = await request.prisma.script.findFirst({
      where: { id: request.params.id, bot: { ownerId } },
    });
    if (!script) return sendNotFound(reply);

    await request.prisma.script.delete({
      where: { id: request.params.id, bot: { ownerId } },
    });
    notifyScriptsChanged([script.botId]);
    return { success: true };
  });
}
