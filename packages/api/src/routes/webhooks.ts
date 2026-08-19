import type { FastifyInstance } from 'fastify';
import {
  WEBHOOK_EVENT_TYPES,
  deliverWebhook,
  isWebhookUrlAllowed,
  stripControlChars,
  ensureEncrypted,
  decryptCredential,
} from '@bothive/core';
import { parsePage } from '../utils/query.js';
import { requireAuth } from '../utils/auth-hook.js';

interface WebhookBody {
  name?: string;
  url?: string;
  events?: string[];
  botId?: string | null;
  secret?: string | null;
  enabled?: boolean;
}

function validateUrl(value: string): boolean {
  return isWebhookUrlAllowed(value);
}

function validateEvents(value: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((e) => (WEBHOOK_EVENT_TYPES as readonly string[]).includes(e))
  );
}

function fieldErrors(body: Partial<WebhookBody>): Record<string, string> | null {
  if (body.name === undefined || typeof body.name !== 'string' || body.name.trim().length === 0)
    return { name: 'must be a non-empty string' };
  if (body.url === undefined || typeof body.url !== 'string' || !validateUrl(body.url))
    return { url: 'must be a valid http(s) URL' };
  if (body.events === undefined || !validateEvents(body.events))
    return { events: `must be a non-empty subset of ${WEBHOOK_EVENT_TYPES.join(', ')}` };
  if (body.botId !== undefined && body.botId !== null && typeof body.botId !== 'string')
    return { botId: 'must be a string or null' };
  if (body.secret !== undefined && body.secret !== null && typeof body.secret !== 'string')
    return { secret: 'must be a string or null' };
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean')
    return { enabled: 'must be a boolean' };
  return null;
}

const MAX_ERROR_LENGTH = 300;

/** Strips control characters and caps the length of persisted error text. */
function sanitizeErrorMessage(message: string): string {
  return stripControlChars(message).trim().slice(0, MAX_ERROR_LENGTH);
}

/**
 * Never serialize the HMAC secret to clients (it would let any authenticated
 * reader forge signatures). The dashboard gets a boolean presence flag instead.
 */
function publicWebhook<T extends { secret: string | null }>(
  w: T,
): Omit<T, 'secret'> & { hasSecret: boolean } {
  const { secret, ...rest } = w;
  return { ...rest, hasSecret: Boolean(secret) };
}

function lastErrorSafe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return sanitizeErrorMessage(message) || 'delivery failed';
}

export async function webhookRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', async (request) => {
    const { take, skip } = parsePage(request.query as Record<string, unknown>, {
      limit: 100,
      maxLimit: 1000,
    });
    const webhooks = await request.prisma.webhook.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return { success: true, data: webhooks.map(publicWebhook) };
  });

  app.post<{ Body: WebhookBody }>('/', async (request, reply) => {
    const invalid = fieldErrors(request.body);
    if (invalid)
      return reply.status(422).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: invalid },
      });

    if (request.body.botId) {
      const bot = await request.prisma.bot.findUnique({ where: { id: request.body.botId } });
      if (!bot)
        return reply.status(422).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: { botId: 'bot does not exist' },
          },
        });
    }

    const webhook = await request.prisma.webhook.create({
      data: {
        name: request.body.name!.trim(),
        url: request.body.url!,
        events: request.body.events!,
        botId: request.body.botId ?? null,
        secret: ensureEncrypted(request.body.secret),
        enabled: request.body.enabled ?? true,
      },
    });
    return { success: true, data: publicWebhook(webhook) };
  });

  app.patch<{ Params: { id: string }; Body: Partial<WebhookBody> }>(
    '/:id',
    async (request, reply) => {
      const existing = await request.prisma.webhook.findUnique({
        where: { id: request.params.id },
      });
      if (!existing)
        return reply
          .status(404)
          .send({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });

      const body = { ...existing, ...request.body } as WebhookBody;
      const invalid = fieldErrors(body);
      if (invalid)
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: invalid },
        });

      if (request.body.botId) {
        const bot = await request.prisma.bot.findUnique({ where: { id: request.body.botId } });
        if (!bot)
          return reply.status(422).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid input',
              details: { botId: 'bot does not exist' },
            },
          });
      }

      const data: Record<string, unknown> = {};
      if (request.body.name !== undefined) data.name = request.body.name;
      if (request.body.url !== undefined) data.url = request.body.url;
      if (request.body.events !== undefined) data.events = request.body.events;
      if (request.body.botId !== undefined) data.botId = request.body.botId;
      if (request.body.secret !== undefined) data.secret = ensureEncrypted(request.body.secret);
      if (request.body.enabled !== undefined) data.enabled = request.body.enabled;

      const updated = await request.prisma.webhook.update({
        where: { id: request.params.id },
        data,
      });
      return { success: true, data: publicWebhook(updated) };
    },
  );

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const existing = await request.prisma.webhook.findUnique({ where: { id: request.params.id } });
    if (!existing)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    await request.prisma.webhook.delete({ where: { id: request.params.id } });
    return { success: true };
  });

  app.get<{ Params: { id: string } }>('/:id/deliveries', async (request, reply) => {
    const existing = await request.prisma.webhook.findUnique({ where: { id: request.params.id } });
    if (!existing)
      return reply
        .status(404)
        .send({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });

    const { take, skip } = parsePage(request.query as Record<string, unknown>, {
      limit: 50,
      maxLimit: 200,
    });
    const deliveries = await request.prisma.webhookDelivery.findMany({
      where: { webhookId: request.params.id },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return { success: true, data: deliveries };
  });

  app.post<{ Params: { id: string }; Body?: { sample?: unknown; eventType?: string } }>(
    '/:id/test',
    async (request, reply) => {
      const existing = await request.prisma.webhook.findUnique({
        where: { id: request.params.id },
      });
      if (!existing)
        return reply
          .status(404)
          .send({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });

      const sample = request.body?.sample ?? {};
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
      const eventType =
        typeof request.body?.eventType === 'string' && request.body.eventType.trim().length > 0
          ? request.body.eventType.trim()
          : 'test';

      const payload = JSON.stringify({
        type: eventType,
        platform: 'any',
        botId: existing.botId ?? null,
        timestamp: new Date().toISOString(),
        payload: {
          message: 'Test ping from BotHive',
          app: 'bothive',
          ...(sample as Record<string, unknown>),
        },
      });

      const startedAt = Date.now();
      const recordHistory = async (
        status: 'ok' | 'failed',
        statusCode: number | null,
        error: string | null,
      ) => {
        try {
          await request.prisma.webhookDelivery.create({
            data: {
              webhookId: existing.id,
              eventType,
              botId: existing.botId ?? null,
              status,
              statusCode,
              attempt: 1,
              error,
              latencyMs: Date.now() - startedAt,
            },
          });
        } catch {
          /* best-effort */
        }
      };

      try {
        await deliverWebhook(existing.url, decryptCredential(existing.secret), payload);
        await request.prisma.webhook.update({
          where: { id: existing.id },
          data: {
            lastStatus: 'ok',
            lastError: null,
            lastDeliveredAt: new Date(),
            deliveryCount: { increment: 1 },
          },
        });
        await recordHistory('ok', 200, null);
        return { success: true, message: 'Webhook delivered' };
      } catch (err) {
        const message = lastErrorSafe(err);
        const statusCode =
          typeof (err as Error & { status?: unknown })?.status === 'number'
            ? (err as Error & { status: number }).status
            : null;
        try {
          await request.prisma.webhook.update({
            where: { id: existing.id },
            data: { lastStatus: 'failed', lastError: message, lastDeliveredAt: new Date() },
          });
        } catch {
          /* best-effort */
        }
        await recordHistory('failed', statusCode, message);
        return reply.status(502).send({
          success: false,
          error: { code: 'WEBHOOK_DELIVERY_FAILED', message: 'Webhook delivery failed' },
        });
      }
    },
  );
}
